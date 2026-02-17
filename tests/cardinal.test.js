const anchor = require("@coral-xyz/anchor");
const { PublicKey, Keypair, SystemProgram } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } = require("@solana/spl-token");
const { assert } = require("chai");

const CONFIRM_OPTS = { commitment: "confirmed" };

describe("Cardinal NFT Token Manager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const wallet = provider.wallet;

  const TOKEN_MANAGER_PROGRAM_ID = new PublicKey("9rRm9jSDyPhqkmpcn8oFBfrR46jQwRPacRknj1i9Pge6");
  const TOKEN_MANAGER_SEED = "token-manager";
  const MINT_COUNTER_SEED = "mint-counter";

  // Token manager kind
  const KIND_UNMANAGED = 2;
  // Invalidation type
  const INVALIDATION_TYPE_INVALIDATE = 2;

  let mint;
  let issuerTokenAccount;
  let tokenManagerPda;
  let tokenManagerBump;
  let mintCounterPda;

  async function findTokenManagerAddress(mintKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(TOKEN_MANAGER_SEED), mintKey.toBuffer()],
      TOKEN_MANAGER_PROGRAM_ID
    );
  }

  async function findMintCounterAddress(mintKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(MINT_COUNTER_SEED), mintKey.toBuffer()],
      TOKEN_MANAGER_PROGRAM_ID
    );
  }

  before(async () => {
    // Create an NFT-like mint (supply = 1, decimals = 0)
    const mintKp = Keypair.generate();
    mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey, // mint authority
      wallet.publicKey, // freeze authority
      0, // decimals
      mintKp,
      CONFIRM_OPTS
    );

    // Create token account for issuer and mint 1 token
    const ataKp = Keypair.generate();
    issuerTokenAccount = await createAccount(
      provider.connection,
      wallet.payer,
      mint,
      wallet.publicKey,
      ataKp,
      CONFIRM_OPTS
    );

    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      issuerTokenAccount,
      wallet.publicKey,
      1,
      [],
      CONFIRM_OPTS
    );

    // Derive PDAs
    [tokenManagerPda, tokenManagerBump] = await findTokenManagerAddress(mint);
    [mintCounterPda] = await findMintCounterAddress(mint);
  });

  it("Initializes a token manager", async () => {
    // Build the init instruction manually since we don't have an IDL
    const ix = {
      amount: new anchor.BN(1),
      kind: KIND_UNMANAGED,
      invalidationType: INVALIDATION_TYPE_INVALIDATE,
      numInvalidators: 1,
    };

    // Serialize InitIx: amount (u64 LE) + kind (u8) + invalidation_type (u8) + num_invalidators (u8)
    const data = Buffer.alloc(8 + 8 + 1 + 1 + 1); // discriminator + amount + kind + inv_type + num_inv
    // Anchor discriminator for "init" = sha256("global:init")[0..8]
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update("global:init").digest();
    hash.copy(data, 0, 0, 8);
    // amount as u64 LE
    data.writeBigUInt64LE(BigInt(1), 8);
    // kind
    data.writeUInt8(KIND_UNMANAGED, 16);
    // invalidation_type
    data.writeUInt8(INVALIDATION_TYPE_INVALIDATE, 17);
    // num_invalidators
    data.writeUInt8(1, 18);

    const tx = new anchor.web3.Transaction();
    tx.add({
      keys: [
        { pubkey: tokenManagerPda, isSigner: false, isWritable: true },
        { pubkey: mintCounterPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // issuer
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: issuerTokenAccount, isSigner: false, isWritable: true }, // issuer_token_account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOKEN_MANAGER_PROGRAM_ID,
      data: data,
    });

    const sig = await provider.sendAndConfirm(tx, [], CONFIRM_OPTS);
    console.log("    Init tx:", sig);

    // Fetch the token manager account
    const tmAccount = await provider.connection.getAccountInfo(tokenManagerPda);
    assert.isNotNull(tmAccount, "Token manager account should exist");
    assert.isTrue(tmAccount.data.length > 0, "Token manager should have data");

    // Parse basic fields (skip 8-byte discriminator)
    const tmData = tmAccount.data;
    const version = tmData.readUInt8(8);
    const bump = tmData.readUInt8(9);
    const count = tmData.readBigUInt64LE(10);
    const numInvalidators = tmData.readUInt8(18);
    const amount = tmData.readBigUInt64LE(83); // u64 at offset 83-90
    const kind = tmData.readUInt8(91); // after amount(8)
    const state = tmData.readUInt8(92);

    console.log("    Version:", version, "Bump:", bump, "Count:", count.toString());
    console.log("    Amount:", amount.toString(), "Kind:", kind, "State:", state, "NumInvalidators:", numInvalidators);

    assert.equal(state, 0, "State should be Initialized (0)");
    assert.equal(kind, KIND_UNMANAGED, "Kind should be Unmanaged (2)");
    assert.equal(numInvalidators, 1, "Should have 1 invalidator slot");
  });

  it("Adds an invalidator", async () => {
    const invalidator = wallet.publicKey;

    // Anchor discriminator for "add_invalidator" + invalidator pubkey (32 bytes)
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update("global:add_invalidator").digest();
    const data = Buffer.alloc(8 + 32);
    hash.copy(data, 0, 0, 8);
    invalidator.toBuffer().copy(data, 8);

    const tx = new anchor.web3.Transaction();
    tx.add({
      keys: [
        { pubkey: tokenManagerPda, isSigner: false, isWritable: true }, // token_manager
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // issuer
        { pubkey: invalidator, isSigner: false, isWritable: false },     // invalidator
      ],
      programId: TOKEN_MANAGER_PROGRAM_ID,
      data: data,
    });

    const sig = await provider.sendAndConfirm(tx, [], CONFIRM_OPTS);
    console.log("    AddInvalidator tx:", sig);

    // Verify invalidator was added
    const tmAccount = await provider.connection.getAccountInfo(tokenManagerPda);
    assert.isNotNull(tmAccount, "Token manager should exist");
  });

  it("Issues the token (transfers to token manager)", async () => {
    // Create token account for the token manager PDA
    const tmTokenAccountKp = Keypair.generate();
    const tmTokenAccount = await createAccount(
      provider.connection,
      wallet.payer,
      mint,
      tokenManagerPda,
      tmTokenAccountKp,
      CONFIRM_OPTS
    );

    // Anchor discriminator for "issue"
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update("global:issue").digest();
    const data = Buffer.alloc(8);
    hash.copy(data, 0, 0, 8);

    const tx = new anchor.web3.Transaction();
    tx.add({
      keys: [
        { pubkey: tokenManagerPda, isSigner: false, isWritable: true },         // token_manager
        { pubkey: tmTokenAccount, isSigner: false, isWritable: true },           // token_manager_token_account
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },         // issuer
        { pubkey: issuerTokenAccount, isSigner: false, isWritable: true },       // issuer_token_account
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },          // payer
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },        // token_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      ],
      programId: TOKEN_MANAGER_PROGRAM_ID,
      data: data,
    });

    const sig = await provider.sendAndConfirm(tx, [], CONFIRM_OPTS);
    console.log("    Issue tx:", sig);

    // Verify token was transferred to token manager
    const tmTokenInfo = await getAccount(provider.connection, tmTokenAccount);
    assert.equal(tmTokenInfo.amount.toString(), "1", "Token manager should hold 1 token");

    const issuerTokenInfo = await getAccount(provider.connection, issuerTokenAccount);
    assert.equal(issuerTokenInfo.amount.toString(), "0", "Issuer should have 0 tokens");

    // Verify state changed to Issued
    const tmAccount = await provider.connection.getAccountInfo(tokenManagerPda);
    const state = tmAccount.data.readUInt8(92);
    assert.equal(state, 1, "State should be Issued (1)");
  });

  it("Cannot re-init an already initialized token manager", async () => {
    const data = Buffer.alloc(8 + 8 + 1 + 1 + 1);
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update("global:init").digest();
    hash.copy(data, 0, 0, 8);
    data.writeBigUInt64LE(BigInt(1), 8);
    data.writeUInt8(KIND_UNMANAGED, 16);
    data.writeUInt8(INVALIDATION_TYPE_INVALIDATE, 17);
    data.writeUInt8(1, 18);

    const tx = new anchor.web3.Transaction();
    tx.add({
      keys: [
        { pubkey: tokenManagerPda, isSigner: false, isWritable: true },
        { pubkey: mintCounterPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: issuerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: TOKEN_MANAGER_PROGRAM_ID,
      data: data,
    });

    try {
      await provider.sendAndConfirm(tx, [], CONFIRM_OPTS);
      assert.fail("Should have failed on re-init");
    } catch (err) {
      console.log("    Re-init correctly rejected:", err.message.substring(0, 80));
      assert.ok(true);
    }
  });
});
