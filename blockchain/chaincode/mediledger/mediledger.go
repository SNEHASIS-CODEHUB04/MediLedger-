package main

import (
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type Contract struct{ contractapi.Contract }

type Event struct {
	Action string `json:"action"`
	Actor  string `json:"actor"`
	At     string `json:"at"`
	Mode   string `json:"mode"`
	TxID   string `json:"txId"`
	Status string `json:"status"`
}

type Record struct {
	ID      string   `json:"id"`
	Digest  string   `json:"digest"`
	Owner   string   `json:"owner"`
	Issuer  string   `json:"issuer"`
	Grants  []string `json:"grants"`
	History []Event  `json:"history"`
}

var (
	idPattern        = regexp.MustCompile(`^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$`)
	principalPattern = regexp.MustCompile(`^(Org1MSP|Org2MSP):[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$`)
	digestPattern    = regexp.MustCompile(`^[a-f0-9]{64}$`)
	unavailable      = errors.New("MEDILEDGER_RECORD_UNAVAILABLE")
	conflict         = errors.New("MEDILEDGER_CONFLICT")
	invalid          = errors.New("Invalid ledger arguments")
)

func identity(ctx contractapi.TransactionContextInterface) (string, string, error) {
	client := ctx.GetClientIdentity()
	msp, err := client.GetMSPID()
	if err != nil || (msp != "Org1MSP" && msp != "Org2MSP") {
		return "", "", unavailable
	}
	id, ok, err := client.GetAttributeValue("mediledger.principal")
	if err != nil || !ok || !idPattern.MatchString(id) {
		return "", "", unavailable
	}
	role, ok, err := client.GetAttributeValue("mediledger.role")
	if err != nil || !ok || (role != "ISSUER" && role != "PATIENT" && role != "PROVIDER") {
		return "", "", unavailable
	}
	return msp + ":" + id, role, nil
}

func (c *Contract) Ping() string { return "OK" }

func (c *Contract) RegisterRecord(ctx contractapi.TransactionContextInterface, id, owner, digest string) error {
	issuer, role, err := identity(ctx)
	if err != nil || role != "ISSUER" {
		return unavailable
	}
	msp, _, _ := strings.Cut(issuer, ":")
	if !idPattern.MatchString(id) || !principalPattern.MatchString(owner) ||
		!strings.HasPrefix(owner, msp+":") || issuer == owner || !digestPattern.MatchString(digest) {
		return invalid
	}
	stub := ctx.GetStub()
	existing, err := stub.GetState("record:" + id)
	if err != nil {
		return err
	}
	if existing != nil {
		return conflict
	}
	key, err := stub.CreateCompositeKey("owner", []string{owner, id})
	if err != nil {
		return err
	}
	if err := stub.PutState(key, []byte{1}); err != nil {
		return err
	}
	record := &Record{ID: id, Owner: owner, Issuer: issuer, Digest: digest, Grants: []string{}, History: []Event{}}
	return save(ctx, record, issuer, "RegisterRecord")
}

func save(ctx contractapi.TransactionContextInterface, record *Record, actor, action string) error {
	stub := ctx.GetStub()
	ts, err := stub.GetTxTimestamp()
	if err != nil {
		return err
	}
	record.History = append(record.History, Event{
		Action: action, Actor: actor, At: time.Unix(ts.Seconds, int64(ts.Nanos)).UTC().Format(time.RFC3339Nano),
		Mode: "LIVE_FABRIC", TxID: stub.GetTxID(), Status: "COMMITTED",
	})
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if err := stub.PutState("record:"+record.ID, data); err != nil {
		return err
	}
	event, err := json.Marshal(record.History[len(record.History)-1])
	if err != nil {
		return err
	}
	return stub.SetEvent(action, event)
}

func (c *Contract) ReadRecord(ctx contractapi.TransactionContextInterface, id string) (*Record, error) {
	if !idPattern.MatchString(id) {
		return nil, invalid
	}
	principal, role, err := identity(ctx)
	if err != nil {
		return nil, err
	}
	data, err := ctx.GetStub().GetState("record:" + id)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, unavailable
	}
	var record Record
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, err
	}
	if (role == "PATIENT" && principal == record.Owner) ||
		(role == "ISSUER" && principal == record.Issuer) ||
		(role == "PROVIDER" && slices.Contains(record.Grants, principal)) {
		return &record, nil
	}
	return nil, unavailable
}

func (c *Contract) GrantAccess(ctx contractapi.TransactionContextInterface, id, provider string) error {
	return c.consent(ctx, id, provider, true)
}

func (c *Contract) RevokeAccess(ctx contractapi.TransactionContextInterface, id, provider string) error {
	return c.consent(ctx, id, provider, false)
}

func (c *Contract) consent(ctx contractapi.TransactionContextInterface, id, provider string, grant bool) error {
	principal, role, err := identity(ctx)
	if err != nil || role != "PATIENT" {
		return unavailable
	}
	record, err := c.ReadRecord(ctx, id)
	if err != nil {
		return err
	}
	if !principalPattern.MatchString(provider) || provider == principal {
		return invalid
	}
	index := slices.Index(record.Grants, provider)
	if grant {
		if index >= 0 {
			return conflict
		}
		record.Grants = append(record.Grants, provider)
		return save(ctx, record, principal, "GrantAccess")
	}
	if index < 0 {
		return conflict
	}
	record.Grants = slices.Delete(record.Grants, index, index+1)
	return save(ctx, record, principal, "RevokeAccess")
}

func (c *Contract) CheckAccess(ctx contractapi.TransactionContextInterface, id string) (bool, error) {
	_, err := c.ReadRecord(ctx, id)
	if errors.Is(err, unavailable) {
		return false, nil
	}
	return err == nil, err
}

func (c *Contract) VerifyDocumentHash(ctx contractapi.TransactionContextInterface, id, digest string) (bool, error) {
	if !digestPattern.MatchString(digest) {
		return false, invalid
	}
	_, role, err := identity(ctx)
	if err != nil || role != "PROVIDER" {
		return false, unavailable
	}
	record, err := c.ReadRecord(ctx, id)
	if err != nil {
		return false, err
	}
	return record.Digest == digest, nil
}

func (c *Contract) GetRecordHistory(ctx contractapi.TransactionContextInterface, id string) ([]Event, error) {
	record, err := c.ReadRecord(ctx, id)
	if err != nil {
		return nil, err
	}
	return record.History, nil
}

func (c *Contract) GetPatientRecords(ctx contractapi.TransactionContextInterface) ([]string, error) {
	principal, role, err := identity(ctx)
	if err != nil || role != "PATIENT" {
		return nil, unavailable
	}
	stub := ctx.GetStub()
	results, err := stub.GetStateByPartialCompositeKey("owner", []string{principal})
	if err != nil {
		return nil, err
	}
	defer results.Close()
	ids := []string{}
	for results.HasNext() {
		result, err := results.Next()
		if err != nil {
			return nil, err
		}
		_, attrs, err := stub.SplitCompositeKey(result.Key)
		if err != nil {
			return nil, err
		}
		ids = append(ids, attrs[1])
	}
	return ids, nil
}
