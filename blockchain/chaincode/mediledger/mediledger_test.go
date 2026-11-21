package main

import (
	"crypto/x509"
	"errors"
	"strings"
	"testing"

	"github.com/hyperledger/fabric-chaincode-go/shimtest"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type identityStub struct {
	id, role, msp string
}

func (id identityStub) GetX509Certificate() (*x509.Certificate, error) { return nil, nil }

func (id identityStub) GetID() (string, error)    { return id.id, nil }
func (id identityStub) GetMSPID() (string, error) { return id.msp, nil }
func (id identityStub) GetAttributeValue(name string) (string, bool, error) {
	switch name {
	case "mediledger.principal":
		return id.id, true, nil
	case "mediledger.role":
		return id.role, true, nil
	default:
		return "", false, nil
	}
}
func (id identityStub) AssertAttributeValue(name, expected string) error {
	if value, ok, _ := id.GetAttributeValue(name); ok && value == expected {
		return nil
	}
	return errors.New("unexpected attribute")
}

func TestWorkflow(t *testing.T) {
	if _, err := contractapi.NewChaincode(&Contract{}); err != nil {
		t.Fatal(err)
	}
	stub := shimtest.NewMockStub("mediledger", nil)
	ledger := &Contract{}
	ctx := &contractapi.TransactionContext{}
	ctx.SetStub(stub)
	const (
		record   = "00000000-0000-4000-8000-000000000000"
		issuer   = "10000000-0000-4000-8000-000000000001"
		patient  = "10000000-0000-4000-8000-000000000002"
		provider = "10000000-0000-4000-8000-000000000003"
		other    = "10000000-0000-4000-8000-000000000004"
	)
	digest := strings.Repeat("a", 64)
	run := func(id, role, org, tx string, f func() error, want error) {
		t.Helper()
		ctx.SetClientIdentity(identityStub{id, role, org})
		stub.MockTransactionStart(tx)
		defer stub.MockTransactionEnd(tx)
		if err := f(); !errors.Is(err, want) {
			t.Fatalf("%s: got %v, want %v", tx, err, want)
		}
	}
	register := func() error { return ledger.RegisterRecord(ctx, record, "Org1MSP:"+patient, digest) }
	read := func() error { _, err := ledger.ReadRecord(ctx, record); return err }
	grant := func() error { return ledger.GrantAccess(ctx, record, "Org2MSP:"+provider) }
	revoke := func() error { return ledger.RevokeAccess(ctx, record, "Org2MSP:"+provider) }
	run(provider, "PROVIDER", "Org2MSP", "unknown", read, unavailable)
	run(provider, "PROVIDER", "Org2MSP", "bad-issuer", register, unavailable)
	run(issuer, "ISSUER", "UnknownMSP", "bad-msp", register, unavailable)
	run(issuer, "ISSUER", "Org1MSP", "bad-hash", func() error {
		return ledger.RegisterRecord(ctx, record, "Org1MSP:"+patient, "invalid")
	}, invalid)
	run(issuer, "ISSUER", "Org1MSP", "register", register, nil)
	run(issuer, "ISSUER", "Org1MSP", "duplicate", register, conflict)
	run(other, "PATIENT", "Org1MSP", "wrong-owner", grant, unavailable)
	run(patient, "PATIENT", "Org2MSP", "wrong-owner-msp", grant, unavailable)
	run(provider, "PROVIDER", "Org2MSP", "before-consent", read, unavailable)
	run(patient, "PATIENT", "Org1MSP", "grant", grant, nil)
	run(provider, "PROVIDER", "Org1MSP", "wrong-provider-msp", read, unavailable)
	run(patient, "PATIENT", "Org1MSP", "duplicate-grant", grant, conflict)
	run(provider, "PROVIDER", "Org2MSP", "verify", func() error {
		match, err := ledger.VerifyDocumentHash(ctx, record, digest)
		if err != nil || !match {
			t.Fatalf("expected match, got %v, %v", match, err)
		}
		match, err = ledger.VerifyDocumentHash(ctx, record, strings.Repeat("b", 64))
		if err != nil || match {
			t.Fatalf("expected mismatch, got %v, %v", match, err)
		}
		return nil
	}, nil)
	run(other, "PATIENT", "Org1MSP", "wrong-revoker", revoke, unavailable)
	run(patient, "PATIENT", "Org1MSP", "revoke", revoke, nil)
	run(provider, "PROVIDER", "Org2MSP", "after-revoke", read, unavailable)
	run(patient, "PATIENT", "Org1MSP", "history", func() error {
		history, err := ledger.GetRecordHistory(ctx, record)
		if err != nil || len(history) != 3 || history[2].TxID != "revoke" {
			t.Fatalf("unexpected history: %#v, %v", history, err)
		}
		return nil
	}, nil)
}
