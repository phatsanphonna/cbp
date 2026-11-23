package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"math/big"
	"net"
	"os"
	"testing"
	"time"

	rpc "cbp/agent-rpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func TestEnrollmentOverTLS(t *testing.T) {
	dir := t.TempDir()
	const host = "host-a"
	path := recordPath(dir, host)
	invite := rpc.NewToken()
	token := rpc.NewToken()
	if err := writeRecord(path, agentRecord{InviteHash: digest(invite), ExpiresAt: time.Now().Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	report, err := structpb.NewStruct(map[string]any{
		"hostname": "web-a", "operatingSystem": "linux", "architecture": "amd64",
		"collectedAt": time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	conn := connectTestController(t, dir)

	call := func(host, credential, method string, req any, want codes.Code) {
		t.Helper()
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		defer cancel()
		ctx = metadata.AppendToOutgoingContext(ctx, rpc.HostHeader, host, "authorization", "Bearer "+credential)
		if err := conn.Invoke(ctx, method, req, &emptypb.Empty{}); status.Code(err) != want {
			t.Fatalf("%s: got %v, want %v", method, err, want)
		}
	}
	call(host, token, rpc.CheckInMethod, report, codes.Unauthenticated)
	call(host, token, rpc.EnrollMethod, wrapperspb.String(rpc.NewToken()), codes.Unauthenticated)
	call(host, token, rpc.EnrollMethod, wrapperspb.String(invite), codes.OK)
	call(host, rpc.NewToken(), rpc.EnrollMethod, wrapperspb.String(invite), codes.Unauthenticated)
	call("host-b", token, rpc.CheckInMethod, report, codes.Unauthenticated)
	call(host, token, rpc.CheckInMethod, &structpb.Struct{}, codes.InvalidArgument)
	call(host, token, rpc.CheckInMethod, report, codes.OK)

	record, err := readRecord(path)
	if err != nil || record.TokenHash != digest(token) || record.InviteHash != "" {
		t.Fatal("expected only the agent token hash in state", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	call(host, token, rpc.CheckInMethod, report, codes.Unauthenticated)
}

func connectTestController(t *testing.T, dir string) *grpc.ClientConn {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		DNSNames:     []string{"controller.test"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Minute),
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, public, private)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(cert)
	server := grpc.NewServer(grpc.Creds(credentials.NewTLS(&tls.Config{
		Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: private}},
	})))
	rpc.RegisterController(server, &controller{stateDir: dir})
	listener := bufconn.Listen(1024 * 1024)
	go server.Serve(listener)
	t.Cleanup(server.Stop)
	conn, err := grpc.NewClient("passthrough:///controller.test",
		grpc.WithTransportCredentials(credentials.NewClientTLSFromCert(roots, "")),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}
