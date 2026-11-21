#!/usr/bin/env bash
set -euo pipefail
umask 077

network="$(realpath "${1:?Provide the Fabric samples test-network directory}")"
output="$(realpath -m "${2:?Provide an unused private identity directory}")"
if [[ -e "$output" ]]; then
  printf '%s\n' "Use a new identity directory." >&2
  exit 1
fi
export PATH="$(dirname "$network")/bin:$PATH"
command -v fabric-ca-client >/dev/null
mkdir -p "$output"
work="$(mktemp -d)"
trap 'rm -r -- "$work"' EXIT

enroll() {
  local org="$1" port="$2" account="$3" role="$4" id="$5"
  local ca="ca-org$org"
  local tls="$network/organizations/fabric-ca/org$org/ca-cert.pem"
  local admin="$work/admin$org"
  local secret
  secret="$(openssl rand -hex 24)"
  if [[ ! -d "$admin/msp" ]]; then
    FABRIC_CA_CLIENT_HOME="$admin" fabric-ca-client enroll -u "https://admin:adminpw@localhost:$port" --caname "$ca" --tls.certfiles "$tls"
  fi
  FABRIC_CA_CLIENT_HOME="$admin" fabric-ca-client register --caname "$ca" --tls.certfiles "$tls" \
    --id.name "$account" --id.secret "$secret" --id.type client --id.maxenrollments 1 \
    --id.attrs "mediledger.principal=$id:ecert,mediledger.role=$role:ecert" >/dev/null
  FABRIC_CA_CLIENT_HOME="$work/$account" fabric-ca-client enroll --caname "$ca" \
    --tls.certfiles "$tls" -u "https://$account:$secret@localhost:$port"
  mkdir -p "$output/$id"
  install -m 600 "$work/$account/msp/signcerts/cert.pem" "$output/$id/cert.pem"
  local keys=("$work/$account"/msp/keystore/*)
  [[ ${#keys[@]} -eq 1 ]]
  install -m 600 "${keys[0]}" "$output/$id/key.pem"
}

enroll 1 7054 mediledger-issuer ISSUER 10000000-0000-4000-8000-000000000001
enroll 1 7054 mediledger-patient PATIENT 10000000-0000-4000-8000-000000000002
enroll 2 8054 mediledger-provider PROVIDER 10000000-0000-4000-8000-000000000003
enroll 1 7054 mediledger-patient-b PATIENT 10000000-0000-4000-8000-000000000004
