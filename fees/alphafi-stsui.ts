import { FetchOptions, SimpleAdapter } from "../adapters/types";
import { CHAIN } from "../helpers/chains";
import { queryEvents } from "../helpers/sui";

// AlphaFi stSUI — liquid staking fees.
//
// stSUI is built on AlphaFi's (SpringSui-derived) liquid_staking standard. Each
// epoch, liquid_staking::refresh emits EpochChangedEvent with the SUI supply
// before/after rewards and the protocol's spread-fee commission:
//   rewards (fees)   = new_sui_supply - old_sui_supply   (gross staking yield)
//   revenue          = spread_fee                         (AlphaFi's cut)
//   supply-side      = rewards - spread_fee               (paid to stSUI holders)
// Events are wrapped by the standard's events::Event<T>.
const PKG = "0xc35ee7fee75782806890cf8ed8536b52b4ba0ace0fb46b944f1155cc5945baa3";
const EPOCH_EVENT = `${PKG}::events::Event<${PKG}::liquid_staking::EpochChangedEvent>`;
const STSUI = "0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI";
const SUI = "0x2::sui::SUI";

const fetch = async (options: FetchOptions) => {
  const dailyFees = options.createBalances();
  const dailyRevenue = options.createBalances();
  const dailySupplySideRevenue = options.createBalances();

  const events = await queryEvents({
    eventType: EPOCH_EVENT,
    options,
    transform: (i: any) => i.event,
  });

  for (const e of events) {
    if ("0x" + e.typename?.name !== STSUI) continue; // this liquid_staking package may host multiple LSTs
    const rewards = BigInt(e.new_sui_supply) - BigInt(e.old_sui_supply); // gross staking rewards
    if (rewards <= 0n) continue;
    const spread = BigInt(e.spread_fee ?? 0);
    dailyFees.add(SUI, rewards);
    dailyRevenue.add(SUI, spread);
    dailySupplySideRevenue.add(SUI, rewards - spread);
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
  Fees: "Staking rewards earned by the SUI backing stSUI.",
  Revenue: "Spread fee (commission) retained by AlphaFi from staking rewards.",
  ProtocolRevenue: "Spread fee retained by AlphaFi.",
  SupplySideRevenue: "Staking rewards passed through to stSUI holders.",
  HoldersRevenue: "No holders revenue.",
};

const adapter: SimpleAdapter = {
  version: 2,
  adapter: {
    [CHAIN.SUI]: {
      fetch,
      start: "2024-12-17",
    },
  },
  methodology,
};

export default adapter;
