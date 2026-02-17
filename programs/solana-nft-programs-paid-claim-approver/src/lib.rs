pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("BcpUG33Z6S3sDbT1YGXmYgE8D2VQ1i2x8yZMzA3yXtFx");

#[program]
pub mod solana_nft_programs_paid_claim_approver {
    use super::*;

    pub fn init(ctx: Context<InitCtx>, ix: InitIx) -> Result<()> {
        init::handler(ctx, ix)
    }

    pub fn pay<'key, 'accounts, 'remaining, 'info>(ctx: Context<'key, 'accounts, 'remaining, 'info, PayCtx<'info>>) -> Result<()> {
        pay::handler(ctx)
    }

    pub fn close(ctx: Context<CloseCtx>) -> Result<()> {
        close::handler(ctx)
    }
}
