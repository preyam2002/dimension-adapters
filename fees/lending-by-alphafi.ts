import { FetchOptions, SimpleAdapter } from "../adapters/types";
import { CHAIN } from "../helpers/chains";
import { queryEvents } from "../helpers/sui";

// AlphaLend on-chain lending fees.
//
// AlphaLend is one on-chain protocol that was operated under Bluefin until the
// partnership ended on 2026-05-17, then reverted to AlphaFi. TVL is handed off
// at that timestamp in projects/{bluefin-alphalend,lending-by-alphafi}; this
// adapter reports the fees/revenue for the AlphaFi (post-switch) side, mirroring
// the TVL handoff. Pre-switch fees stay on the Bluefin listing.
const SWITCH_TS = 1778976000; // 2026-05-17 — AlphaFi partnership ended

// market::compound_interest emits FeeEarnedEvent_V3 on every interest accrual,
// wrapped by alpha_lending's `events::Event<T>`. The wrapper lives in the
// original package; FeeEarnedEvent_V3 was added in a later upgrade and so keeps
// that upgrade's package id (Move type identity is fixed once a struct is defined).
const EVENTS_PKG = "0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4";
const FEE_V3_PKG = "0xc8a5487ce3e5b78644f725f83555e1c65c38f0424a72781ed5de4f0369725c79";
const FEE_EVENT_V3 = `${EVENTS_PKG}::events::Event<${FEE_V3_PKG}::market::FeeEarnedEvent_V3>`;
const LIQUIDATION_EVENT = `${EVENTS_PKG}::events::Event<${EVENTS_PKG}::alpha_lending::LiquidationEvent>`;

const fetch = async (options: FetchOptions) => {
  const dailyFees = options.createBalances();
  const dailyRevenue = options.createBalances();
  const dailySupplySideRevenue = options.createBalances();

  // Borrow interest (the dominant fee): market::compound_interest -> FeeEarnedEvent_V3
  const interestEvents = await queryEvents({
    eventType: FEE_EVENT_V3,
    options,
    transform: (i: any) => i.event,
  });
  for (const e of interestEvents) {
    const coin = "0x" + e.coin_type.name;
    const interest = BigInt(e.interest_earned ?? 0);          // total borrower interest
    const revenue = BigInt(e.market_fee ?? 0) + BigInt(e.protocol_fee ?? 0); // protocol spread cut
    dailyFees.add(coin, interest);
    dailyRevenue.add(coin, revenue);
    dailySupplySideRevenue.add(coin, interest - revenue);     // interest paid to lenders
  }

  // Liquidation fees (protocol's cut of seized collateral; small but completes the picture)
  const liquidationEvents = await queryEvents({
    eventType: LIQUIDATION_EVENT,
    options,
    transform: (i: any) => i.event,
  });
  for (const e of liquidationEvents) {
    const fee = BigInt(e.liquidation_fee ?? 0);
    if (fee <= 0n || !e.withdraw_type?.name) continue;
    const coin = "0x" + e.withdraw_type.name;                 // fee taken from the seized collateral
    dailyFees.add(coin, fee);
    dailyRevenue.add(coin, fee);                              // 100% protocol revenue
  }

  return {
    dailyFees,
    dailyUserFees: dailyFees,
    dailyRevenue,
    dailyProtocolRevenue: dailyRevenue,
    dailyHoldersRevenue: 0,
    dailySupplySideRevenue,
  };
};

const methodology = {
  Fees: "Total interest paid by borrowers across all AlphaLend markets, plus liquidation fees.",
  Revenue: "Protocol spread fee retained from borrower interest, plus liquidation fees.",
  ProtocolRevenue: "Protocol spread fee retained from borrower interest, plus liquidation fees.",
  SupplySideRevenue: "Interest paid out to suppliers/lenders.",
  HoldersRevenue: "No holders revenue.",
};

const adapter: SimpleAdapter = {
  version: 2,
  adapter: {
    [CHAIN.SUI]: {
      fetch,
      start: SWITCH_TS,
    },
  },
  methodology,
};

export default adapter;
