import { HttpAgent, Actor, type Identity } from "@icp-sdk/core/agent";
import { idlFactory } from "../declarations/backend.did";

export const CANISTER_ID = "6giix-piaaa-aaaag-ay5ea-cai";

export async function createBackendActor(identity: Identity | undefined) {
  const agent = await HttpAgent.create({ identity, host: "https://icp0.io" });
  return Actor.createActor(idlFactory, { agent, canisterId: CANISTER_ID });
}
