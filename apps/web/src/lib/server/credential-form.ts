const maxCredentialFormBytes = 8192;

export async function readCredentialForm(request: Request) {
  if (Number(request.headers.get('content-length')) > maxCredentialFormBytes)
    return { status: 413 } as const;
  if (!request.body) return { status: 400 } as const;

  let bytes = 0;
  const limited = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maxCredentialFormBytes)
          controller.error(new Error('Credential form too large'));
        else controller.enqueue(chunk);
      },
    }),
  );
  try {
    const headers = {
      'content-type': request.headers.get('content-type') ?? '',
    };
    return {
      fields: await new Response(limited, { headers }).formData(),
    } as const;
  } catch {
    return { status: bytes > maxCredentialFormBytes ? 413 : 400 } as const;
  }
}
