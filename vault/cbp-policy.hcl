path "cbp/data/deployments/*" {
  capabilities = ["create", "read", "update"]
}

path "cbp/metadata/deployments" {
  capabilities = ["list"]
}

path "cbp/metadata/deployments/*" {
  capabilities = ["read", "delete"]
}

path "cbp/data/credentials/*" {
  capabilities = ["create", "read", "update"]
}

path "cbp/metadata/credentials/*" {
  capabilities = ["create", "read", "update", "delete"]
}

path "cbp/metadata/credentials/ansible-profile" {
  capabilities = ["list"]
}
