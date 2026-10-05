//! Configuration of the five pallets. Everything but `Seeds` is the solochain
//! template's, less what fees and balances needed.

use frame_support::{
	derive_impl,
	dispatch::DispatchClass,
	parameter_types,
	traits::{ConstBool, ConstU32, ConstU64},
	weights::{
		constants::{RocksDbWeight, WEIGHT_REF_TIME_PER_SECOND},
		Weight,
	},
	BoundedVec,
};
use frame_system::limits::{BlockLength, BlockWeights};
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
use sp_runtime::Perbill;
use sp_version::RuntimeVersion;

use super::{
	AccountId, Aura, Balance, Block, BlockNumber, Grandpa, Hash, Nonce, PalletInfo, Runtime,
	RuntimeCall, RuntimeEvent, RuntimeOrigin, RuntimeTask, SeedKeys, UNIT, MINUTES, HOURS,
	SLOT_DURATION, VERSION,
};

const NORMAL_DISPATCH_RATIO: Perbill = Perbill::from_percent(75);

parameter_types! {
	pub const BlockHashCount: BlockNumber = 2400;
	pub const Version: RuntimeVersion = VERSION;

	/// We allow for 2 seconds of compute with a 6 second average block time.
	pub RuntimeBlockWeights: BlockWeights = BlockWeights::with_sensible_defaults(
		Weight::from_parts(2u64 * WEIGHT_REF_TIME_PER_SECOND, u64::MAX),
		NORMAL_DISPATCH_RATIO,
	);
	pub RuntimeBlockLength: BlockLength = BlockLength::builder()
		.max_length(5 * 1024 * 1024)
		.modify_max_length_for_class(DispatchClass::Normal, |m| *m = NORMAL_DISPATCH_RATIO * *m)
		.build();
	pub const SS58Prefix: u8 = 42;
}

#[allow(unused_parens)]
type SingleBlockMigrations = ();

#[derive_impl(frame_system::config_preludes::SolochainDefaultConfig)]
impl frame_system::Config for Runtime {
	type Block = Block;
	type BlockWeights = RuntimeBlockWeights;
	type BlockLength = RuntimeBlockLength;
	type AccountId = AccountId;
	type Nonce = Nonce;
	type Hash = Hash;
	type BlockHashCount = BlockHashCount;
	type DbWeight = RocksDbWeight;
	type Version = Version;
	/// No balances pallet: an account holds nothing but its nonce here. Units live in `Seeds`.
	type AccountData = ();
	type SS58Prefix = SS58Prefix;
	type MaxConsumers = frame_support::traits::ConstU32<16>;
	type SingleBlockMigrations = SingleBlockMigrations;
}

impl pallet_aura::Config for Runtime {
	type AuthorityId = AuraId;
	type DisabledValidators = ();
	type MaxAuthorities = ConstU32<32>;
	type AllowMultipleBlocksPerSlot = ConstBool<false>;
	type SlotDuration = pallet_aura::MinimumPeriodTimesTwo<Runtime>;
}

impl pallet_grandpa::Config for Runtime {
	type RuntimeEvent = RuntimeEvent;
	type WeightInfo = ();
	type MaxAuthorities = ConstU32<32>;
	type MaxNominators = ConstU32<0>;
	type MaxSetIdSessionEntries = ConstU64<0>;
	type KeyOwnerProof = sp_core::Void;
	type EquivocationReportSystem = ();
}

impl pallet_timestamp::Config for Runtime {
	type Moment = u64;
	type OnTimestampSet = Aura;
	type MinimumPeriod = ConstU64<{ SLOT_DURATION / 2 }>;
	type WeightInfo = ();
}

/// Hands the seated members' keys to consensus. GRANDPA first, because it is the
/// one that can refuse (a change already pending); Aura only once it has accepted,
/// so the two sets never disagree.
pub struct ConsensusSet;
impl pallet_seeds::ValidatorSet<SeedKeys> for ConsensusSet {
	fn set(keys: &[SeedKeys]) -> bool {
		if keys.is_empty() {
			return false;
		}
		let grandpa = keys.iter().map(|k| (k.grandpa.clone(), 1)).collect();
		if Grandpa::schedule_change(grandpa, 0, None).is_err() {
			return false;
		}
		let aura = keys.iter().map(|k| k.aura.clone()).collect::<alloc::vec::Vec<_>>();
		Aura::change_authorities(BoundedVec::truncate_from(aura));
		true
	}
}

// Lab values: short enough to watch a full cycle in one sitting. A chain that
// mattered would run eras of a day and maturity of weeks.
parameter_types! {
	pub const EraLength: u32 = 10 * MINUTES;
	pub const WitnessesRequired: u32 = 2;
	pub const WitnessAllowance: u32 = 3;
	pub const CandidacyTimeout: u32 = HOURS;
	pub const MaxStrikes: u32 = 2;
	pub const MaturityMint: Balance = 10 * UNIT;
	pub const MaxPendingPoints: u32 = 3;
	pub const MaturityPeriod: u32 = 5 * MINUTES;
	pub const ChallengeThreshold: u32 = 3;
	pub const MaxMaturingPerBlock: u32 = 16;
	pub const MaxNoteLen: u32 = 128;
	pub const VotingPeriod: u32 = 2 * MINUTES;
	pub const MaxValidators: u32 = 21;
	pub const MaxKeyHolders: u32 = 1000;
}

impl pallet_seeds::Config for Runtime {
	type RuntimeEvent = RuntimeEvent;
	type SessionKeys = SeedKeys;
	type ValidatorSet = ConsensusSet;
	type EraLength = EraLength;
	type WitnessesRequired = WitnessesRequired;
	type WitnessAllowance = WitnessAllowance;
	type CandidacyTimeout = CandidacyTimeout;
	type MaxStrikes = MaxStrikes;
	type MaturityMint = MaturityMint;
	type MaxPendingPoints = MaxPendingPoints;
	type MaturityPeriod = MaturityPeriod;
	type ChallengeThreshold = ChallengeThreshold;
	type MaxMaturingPerBlock = MaxMaturingPerBlock;
	type MaxNoteLen = MaxNoteLen;
	type VotingPeriod = VotingPeriod;
	type MaxValidators = MaxValidators;
	type MaxKeyHolders = MaxKeyHolders;
}
