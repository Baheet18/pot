import "./live-env";
import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { assertAllowedPrograms, assertTxAllowed, compileTx, PANTA_PROGRAM_ID } from "../src";

const payer = Keypair.generate().publicKey.toBase58();
const ix = (programId: string) => ({ programId, data: "", accounts: [{ pubkey: payer, isSigner: true, isWritable: true }] });
const BH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

describe("transactions only call Panta + standard Solana programs", () => {
  it("allows Panta, System, Token, Token-2022, Associated Token and Compute Budget", () => {
    expect(() => assertAllowedPrograms([PANTA_PROGRAM_ID, "11111111111111111111111111111111", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "ComputeBudget111111111111111111111111111111"].map(ix))).not.toThrow();
  });
  it("refuses anything else, before compiling", async () => {
    const evil = Keypair.generate().publicKey.toBase58();
    expect(() => assertAllowedPrograms([ix(PANTA_PROGRAM_ID), ix(evil)])).toThrow(/unexpected program/);
    await expect(compileTx({ payer, instructions: [ix(evil)], recentBlockhash: BH })).rejects.toThrow(/unexpected program/);
    await expect(compileTx({ payer, instructions: [ix("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")], recentBlockhash: BH })).rejects.toThrow(/unexpected program/);
    expect((await compileTx({ payer, instructions: [ix(PANTA_PROGRAM_ID)], recentBlockhash: BH })).tx).toBeTruthy();
  });
  it("checks Panta-built create transactions too (programs and fee payer)", () => {
    const build = (pay: string, ixs: any[]) => Buffer.from(new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(pay), recentBlockhash: BH, instructions: ixs }).compileToV0Message()).serialize()).toString("base64");
    const transfer = SystemProgram.transfer({ fromPubkey: new PublicKey(payer), toPubkey: Keypair.generate().publicKey, lamports: 1 });
    expect(() => assertTxAllowed(build(payer, [transfer]), payer)).not.toThrow();
    expect(() => assertTxAllowed(build(payer, [{ ...transfer, programId: Keypair.generate().publicKey }]), payer)).toThrow(/unexpected program/);
    expect(() => assertTxAllowed(build(Keypair.generate().publicKey.toBase58(), [transfer]), payer)).toThrow(/fee payer/);
  });
});
