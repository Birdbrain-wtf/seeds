//! # Seeds
//!
//! The one application pallet of a chain with one job. Build and run notes:
//! `chain/README.md`.
//!
//! Bitcoin kept one ledger. This keeps one too, of who joined, what they put
//! forward and which of it held up. Everything else a chain usually carries
//! (balances pallet, fees, sudo, treasury, bounties) is absent.
//!
//! Five jobs, one pallet:
//!
//! 1. **Admit.** A person becomes a member when enough existing members witness
//!    them against the same session evidence (an attendance root, say). Each
//!    witness has a small allowance per era, each community a cap per era, and a
//!    member later expelled leaves a strike on everyone who witnessed them. One
//!    key, one membership. The chain cannot tell whether two keys are one person,
//!    so the witnesses, the allowance, the cap and the strikes carry that.
//! 2. **Mint.** KAB comes into existence in exactly two places: when a person is
//!    admitted, and when a proposed point in the knowledge graph matures.
//! 3. **Record.** Proposing a point takes a KAB bond. It is returned with the
//!    maturity mint if nobody successfully challenges it, and burned if enough
//!    distinct members do. Nothing goes to a treasury, because there is none.
//! 4. **Approve upgrades.** Members vote, one member one vote. While the founding
//!    set holds control, a founder's proposal passes unless a third of members
//!    object. Members end that control by simple majority, once, for good.
//! 5. **Seat validators.** A member who registers session keys queues for a
//!    validator seat, oldest admission first. The runtime turns the list into
//!    consensus authorities through [`ValidatorSet`], so this pallet depends on
//!    nothing but `frame_system` and moves to another FRAME fork as a rename.
//!
//! Only members may sign transactions ([`OnlyMembers`]), which is what stands in
//! for fees as the guard against spam. The one unsigned call is [`Pallet::claim`],
//! which lets a holder from the old chain move a snapshot balance with a signature
//! from their old key, so nobody's KAB moves without them.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

#[cfg(test)]
mod tests;

/// Turns the seated validators' keys into consensus authorities. The runtime
/// implements it over Aura and GRANDPA. Returns false if the change could not be
/// applied this time (GRANDPA refuses while a change is pending), and the pallet
/// tries again next era.
pub trait ValidatorSet<Keys> {
	fn set(keys: &[Keys]) -> bool;
}

impl<Keys> ValidatorSet<Keys> for () {
	fn set(_: &[Keys]) -> bool {
		true
	}
}

#[frame_support::pallet]
pub mod pallet {
	use super::ValidatorSet;
	use alloc::vec::Vec;
	use codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
	use frame_support::{
		pallet_prelude::*,
		sp_runtime::traits::{Saturating, UniqueSaturatedInto},
		traits::{BuildGenesisConfig, OriginTrait},
	};
	use frame_system::pallet_prelude::*;
	use scale_info::TypeInfo;
	use sp_core::{ed25519, sr25519, H256};

	pub type Kab = u128;
	pub type CommunityId = u32;
	pub type MotionId = u32;

	/// The founding community, the one the genesis members belong to.
	pub const FOUNDING_COMMUNITY: CommunityId = 0;

	/// What a holder of the old chain signs to move a snapshot balance:
	/// this prefix followed by the SCALE-encoded destination account.
	pub const CLAIM_PREFIX: &[u8] = b"birdbrain-claim:";

	#[pallet::pallet]
	pub struct Pallet<T>(_);

	#[pallet::config]
	pub trait Config: frame_system::Config {
		#[allow(deprecated)]
		type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

		/// Whatever the runtime's consensus needs from a validator (Aura + GRANDPA keys).
		type SessionKeys: Parameter + Member + MaxEncodedLen + MaybeSerializeDeserialize;
		/// Applies a new validator set to consensus.
		type ValidatorSet: ValidatorSet<Self::SessionKeys>;

		/// Blocks per era. Allowances, admission caps and the validator set turn over on it.
		#[pallet::constant]
		type EraLength: Get<u32>;
		/// Distinct members who must witness a candidate against the same evidence.
		#[pallet::constant]
		type WitnessesRequired: Get<u32>;
		/// How many candidates one member may witness per era.
		#[pallet::constant]
		type WitnessAllowance: Get<u32>;
		/// Blocks a candidacy stays open while witnesses gather.
		#[pallet::constant]
		type CandidacyTimeout: Get<u32>;
		/// Strikes at which a member may no longer witness anyone.
		#[pallet::constant]
		type MaxStrikes: Get<u32>;

		/// KAB minted to a person on admission.
		#[pallet::constant]
		type AdmissionMint: Get<Kab>;
		/// KAB minted to the proposer when a point matures.
		#[pallet::constant]
		type MaturityMint: Get<Kab>;
		/// Smallest bond a point can be proposed with.
		#[pallet::constant]
		type MinBond: Get<Kab>;
		/// Blocks from proposal to maturity, during which a point can be challenged.
		#[pallet::constant]
		type MaturityPeriod: Get<u32>;
		/// Distinct members whose challenges forfeit a point.
		#[pallet::constant]
		type ChallengeThreshold: Get<u32>;
		/// Points that can mature in a single block.
		#[pallet::constant]
		type MaxMaturingPerBlock: Get<u32>;
		/// Longest note, in bytes, that may travel with a point.
		#[pallet::constant]
		type MaxNoteLen: Get<u32>;

		/// Blocks a motion stays open for votes.
		#[pallet::constant]
		type VotingPeriod: Get<u32>;
		/// Validator seats.
		#[pallet::constant]
		type MaxValidators: Get<u32>;
		/// Members who may queue for a seat by registering keys.
		#[pallet::constant]
		type MaxKeyHolders: Get<u32>;
	}

	// ---------------------------------------------------------------- types

	#[derive(Encode, Decode, DecodeWithMemTracking, CloneNoBound, PartialEqNoBound, EqNoBound, DebugNoBound, TypeInfo, MaxEncodedLen)]
	#[scale_info(skip_type_params(T))]
	pub struct MemberRecord<T: Config> {
		/// Admission order across the whole network. Seats go oldest first.
		pub index: u64,
		pub community: CommunityId,
		pub admitted_at: BlockNumberFor<T>,
		/// The session evidence the witnesses attested to. Zero for founders.
		pub evidence: H256,
		/// Who vouched. Kept so an expulsion can reach them.
		pub witnesses: BoundedVec<T::AccountId, T::WitnessesRequired>,
		pub founder: bool,
		pub strikes: u32,
	}

	#[derive(Encode, Decode, DecodeWithMemTracking, CloneNoBound, PartialEqNoBound, EqNoBound, DebugNoBound, TypeInfo, MaxEncodedLen)]
	#[scale_info(skip_type_params(T))]
	pub struct Candidacy<T: Config> {
		pub community: CommunityId,
		pub evidence: H256,
		pub witnesses: BoundedVec<T::AccountId, T::WitnessesRequired>,
		pub opened_at: BlockNumberFor<T>,
	}

	#[derive(Encode, Decode, DecodeWithMemTracking, Clone, PartialEq, Eq, Debug, Default, TypeInfo, MaxEncodedLen)]
	pub struct Community {
		pub cap_per_era: u32,
		pub era: u32,
		pub admitted_in_era: u32,
		pub members: u32,
	}

	#[derive(Encode, Decode, DecodeWithMemTracking, Clone, Copy, PartialEq, Eq, Debug, TypeInfo, MaxEncodedLen)]
	pub enum PointStatus {
		Pending,
		Matured,
		Forfeited,
	}

	#[derive(Encode, Decode, DecodeWithMemTracking, CloneNoBound, PartialEqNoBound, EqNoBound, DebugNoBound, TypeInfo, MaxEncodedLen)]
	#[scale_info(skip_type_params(T))]
	pub struct Point<T: Config> {
		pub proposer: T::AccountId,
		pub bond: Kab,
		pub proposed_at: BlockNumberFor<T>,
		pub matures_at: BlockNumberFor<T>,
		pub challengers: BoundedVec<T::AccountId, T::ChallengeThreshold>,
		pub note: BoundedVec<u8, T::MaxNoteLen>,
		pub status: PointStatus,
	}

	#[derive(Encode, Decode, DecodeWithMemTracking, CloneNoBound, PartialEqNoBound, EqNoBound, DebugNoBound, TypeInfo, MaxEncodedLen)]
	#[scale_info(skip_type_params(T))]
	pub enum MotionKind<T: Config> {
		/// Authorise a runtime whose blake2 hash is this. Any member then submits
		/// the code with `system.apply_authorized_upgrade`.
		Upgrade { code_hash: T::Hash },
		/// A new community, empty, with this admission cap per era.
		OpenCommunity { cap_per_era: u32 },
		SetCap { community: CommunityId, cap_per_era: u32 },
		/// Remove a member. Everyone who witnessed them takes a strike.
		Expel { who: T::AccountId },
		/// End founding control. Irreversible.
		EndFounding,
	}

	#[derive(Encode, Decode, DecodeWithMemTracking, CloneNoBound, PartialEqNoBound, EqNoBound, DebugNoBound, TypeInfo, MaxEncodedLen)]
	#[scale_info(skip_type_params(T))]
	pub struct Motion<T: Config> {
		pub kind: MotionKind<T>,
		pub proposer: T::AccountId,
		/// Proposed by a founder while founding control held, so the veto rule applies.
		pub by_founder: bool,
		pub proposed_at: BlockNumberFor<T>,
		pub ends_at: BlockNumberFor<T>,
		pub ayes: u32,
		pub nays: u32,
		/// Members at the moment of proposal. Only they may vote.
		pub electorate: u32,
		/// The first admission index outside that electorate.
		pub electorate_below: u64,
	}

	/// A signature from a key on the old chain. Both schemes give an account id
	/// equal to the public key, which is what the snapshot is keyed on.
	#[derive(Encode, Decode, DecodeWithMemTracking, Clone, PartialEq, Eq, Debug, TypeInfo, MaxEncodedLen)]
	pub enum ClaimSignature {
		Sr25519(sr25519::Signature),
		Ed25519(ed25519::Signature),
	}

	// -------------------------------------------------------------- storage

	#[pallet::storage]
	pub type Members<T: Config> = StorageMap<_, Blake2_128Concat, T::AccountId, MemberRecord<T>>;

	#[pallet::storage]
	pub type MemberCount<T> = StorageValue<_, u32, ValueQuery>;

	#[pallet::storage]
	pub type NextMemberIndex<T> = StorageValue<_, u64, ValueQuery>;

	#[pallet::storage]
	pub type Candidates<T: Config> = StorageMap<_, Blake2_128Concat, T::AccountId, Candidacy<T>>;

	/// member -> (era, candidates witnessed in that era).
	#[pallet::storage]
	pub type WitnessUse<T: Config> = StorageMap<_, Blake2_128Concat, T::AccountId, (u32, u32), ValueQuery>;

	#[pallet::storage]
	pub type Communities<T> = StorageMap<_, Twox64Concat, CommunityId, Community>;

	#[pallet::storage]
	pub type NextCommunityId<T> = StorageValue<_, CommunityId, ValueQuery>;

	#[pallet::storage]
	pub type Balances<T: Config> = StorageMap<_, Blake2_128Concat, T::AccountId, Kab, ValueQuery>;

	/// Everything that exists: minted, plus the old chain's snapshot, less burned bonds.
	#[pallet::storage]
	pub type TotalIssuance<T> = StorageValue<_, Kab, ValueQuery>;

	/// The part of the snapshot nobody has claimed yet.
	#[pallet::storage]
	pub type Unclaimed<T> = StorageValue<_, Kab, ValueQuery>;

	/// Old-chain public key -> KAB waiting to be claimed.
	#[pallet::storage]
	pub type Claims<T> = StorageMap<_, Identity, [u8; 32], Kab>;

	#[pallet::storage]
	pub type Points<T: Config> = StorageMap<_, Identity, H256, Point<T>>;

	#[pallet::storage]
	pub type MaturingAt<T: Config> =
		StorageMap<_, Twox64Concat, BlockNumberFor<T>, BoundedVec<H256, T::MaxMaturingPerBlock>, ValueQuery>;

	#[pallet::storage]
	pub type Motions<T: Config> = StorageMap<_, Twox64Concat, MotionId, Motion<T>>;

	#[pallet::storage]
	pub type NextMotionId<T> = StorageValue<_, MotionId, ValueQuery>;

	#[pallet::storage]
	pub type Votes<T: Config> =
		StorageDoubleMap<_, Twox64Concat, MotionId, Blake2_128Concat, T::AccountId, bool>;

	/// One open motion per member at a time.
	#[pallet::storage]
	pub type OpenMotionOf<T: Config> = StorageMap<_, Blake2_128Concat, T::AccountId, MotionId>;

	#[pallet::storage]
	pub type FoundingActive<T> = StorageValue<_, bool, ValueQuery>;

	#[pallet::storage]
	pub type Keys<T: Config> = StorageMap<_, Blake2_128Concat, T::AccountId, T::SessionKeys>;

	/// Members with keys, in admission order. The first `MaxValidators` are seated.
	#[pallet::storage]
	pub type KeyHolders<T: Config> = StorageValue<_, BoundedVec<T::AccountId, T::MaxKeyHolders>, ValueQuery>;

	/// The set last handed to consensus.
	#[pallet::storage]
	pub type Validators<T: Config> =
		StorageValue<_, BoundedVec<(T::AccountId, T::SessionKeys), T::MaxValidators>, ValueQuery>;

	// -------------------------------------------------------------- genesis

	#[pallet::genesis_config]
	#[derive(frame_support::DefaultNoBound)]
	pub struct GenesisConfig<T: Config> {
		/// The founding set: members of community 0, with keys if they validate.
		pub founders: Vec<(T::AccountId, Option<T::SessionKeys>)>,
		/// Admission cap per era for the founding community.
		pub founding_cap: u32,
		/// The old chain's balances, keyed on public key, waiting to be claimed.
		pub claims: Vec<([u8; 32], Kab)>,
	}

	#[pallet::genesis_build]
	impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
		fn build(&self) {
			Communities::<T>::insert(
				FOUNDING_COMMUNITY,
				Community { cap_per_era: self.founding_cap, ..Default::default() },
			);
			NextCommunityId::<T>::put(FOUNDING_COMMUNITY + 1);
			FoundingActive::<T>::put(!self.founders.is_empty());
			for (who, keys) in &self.founders {
				Pallet::<T>::admit(who.clone(), FOUNDING_COMMUNITY, H256::zero(), Default::default(), true);
				if let Some(k) = keys {
					Pallet::<T>::put_keys(who, k.clone()).expect("too many founders with keys");
				}
			}
			let seated = Pallet::<T>::seat_list();
			Validators::<T>::put(seated);
			let mut total: Kab = 0;
			for (key, amount) in &self.claims {
				Claims::<T>::insert(key, amount);
				total = total.saturating_add(*amount);
			}
			Unclaimed::<T>::put(total);
			TotalIssuance::<T>::mutate(|t| *t = t.saturating_add(total));
		}
	}

	// --------------------------------------------------------------- events

	#[derive(Encode, Decode, DecodeWithMemTracking, Clone, Copy, PartialEq, Eq, Debug, TypeInfo)]
	pub enum MintReason {
		Admission,
		Maturity,
	}

	#[pallet::event]
	#[pallet::generate_deposit(pub(super) fn deposit_event)]
	pub enum Event<T: Config> {
		Witnessed { candidate: T::AccountId, by: T::AccountId, community: CommunityId, count: u32 },
		Admitted { who: T::AccountId, community: CommunityId, index: u64 },
		Minted { to: T::AccountId, amount: Kab, reason: MintReason },
		Proposed { digest: H256, proposer: T::AccountId, bond: Kab },
		Challenged { digest: H256, by: T::AccountId, count: u32 },
		Matured { digest: H256, proposer: T::AccountId },
		Forfeited { digest: H256, burned: Kab },
		MotionOpened { id: MotionId, proposer: T::AccountId, kind: MotionKind<T> },
		Voted { id: MotionId, who: T::AccountId, aye: bool },
		MotionClosed { id: MotionId, passed: bool, ayes: u32, nays: u32, electorate: u32 },
		CommunityOpened { id: CommunityId, cap_per_era: u32 },
		Expelled { who: T::AccountId },
		FoundingEnded,
		KeysSet { who: T::AccountId },
		NewValidators { count: u32 },
		Claimed { old: [u8; 32], to: T::AccountId, amount: Kab },
		Transferred { from: T::AccountId, to: T::AccountId, amount: Kab },
	}

	#[pallet::error]
	pub enum Error<T> {
		NotMember,
		AlreadyMember,
		NoSuchCommunity,
		/// Once a community has enough members to witness for itself, it must.
		OutsideWitness,
		AllowanceSpent,
		Struck,
		/// This candidate already has an open candidacy for another community or evidence.
		CandidacyMismatch,
		AlreadyWitnessed,
		CommunityFull,
		BondTooSmall,
		InsufficientKab,
		PointExists,
		NoSuchPoint,
		NotPending,
		OwnPoint,
		AlreadyChallenged,
		/// Too many points already mature in that block. Try again next block.
		MaturityFull,
		NoteTooLong,
		NoSuchMotion,
		MotionOpen,
		VotingClosed,
		VotingOpen,
		/// Joined after the motion was proposed.
		NotInElectorate,
		OneMotionAtATime,
		FoundingOver,
		BadMotion,
		KeyHoldersFull,
		NothingToClaim,
		BadClaimSignature,
	}

	// ---------------------------------------------------------------- hooks

	#[pallet::hooks]
	impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
		fn on_initialize(now: BlockNumberFor<T>) -> Weight {
			let db = T::DbWeight::get();
			let due = MaturingAt::<T>::take(now);
			let mut weight = db.reads_writes(1, 1);
			for digest in due {
				Self::mature(digest);
				weight = weight.saturating_add(db.reads_writes(4, 4));
			}
			let n: u32 = now.unique_saturated_into();
			if n > 0 && n % T::EraLength::get().max(1) == 0 {
				weight = weight.saturating_add(Self::rotate_validators());
			}
			weight
		}
	}

	// ---------------------------------------------------------------- calls

	#[pallet::call]
	impl<T: Config> Pallet<T> {
		/// Vouch that `candidate` is a person you saw at the session `evidence`
		/// commits to (an attendance root, say). Enough distinct witnesses against
		/// the same evidence admit them.
		#[pallet::call_index(0)]
		#[pallet::weight(Weight::from_parts(40_000_000, 0).saturating_add(T::DbWeight::get().reads_writes(6, 8)))]
		pub fn witness(
			origin: OriginFor<T>,
			candidate: T::AccountId,
			community: CommunityId,
			evidence: H256,
		) -> DispatchResult {
			let by = ensure_signed(origin)?;
			let me = Members::<T>::get(&by).ok_or(Error::<T>::NotMember)?;
			ensure!(me.strikes < T::MaxStrikes::get(), Error::<T>::Struck);
			ensure!(!Members::<T>::contains_key(&candidate), Error::<T>::AlreadyMember);
			let mut c = Communities::<T>::get(community).ok_or(Error::<T>::NoSuchCommunity)?;
			let required = T::WitnessesRequired::get();
			if c.members >= required {
				ensure!(me.community == community, Error::<T>::OutsideWitness);
			}

			let era = Self::era();
			let (used_era, used) = WitnessUse::<T>::get(&by);
			let used = if used_era == era { used } else { 0 };
			ensure!(used < T::WitnessAllowance::get(), Error::<T>::AllowanceSpent);

			let now = frame_system::Pallet::<T>::block_number();
			let timeout: BlockNumberFor<T> = T::CandidacyTimeout::get().into();
			let mut cand = match Candidates::<T>::get(&candidate) {
				Some(open) if now < open.opened_at.saturating_add(timeout) => {
					ensure!(
						open.community == community && open.evidence == evidence,
						Error::<T>::CandidacyMismatch
					);
					open
				},
				_ => Candidacy { community, evidence, witnesses: Default::default(), opened_at: now },
			};
			ensure!(!cand.witnesses.contains(&by), Error::<T>::AlreadyWitnessed);
			cand.witnesses.try_push(by.clone()).map_err(|_| Error::<T>::AlreadyWitnessed)?;
			WitnessUse::<T>::insert(&by, (era, used + 1));
			let count = cand.witnesses.len() as u32;
			Self::deposit_event(Event::Witnessed { candidate: candidate.clone(), by, community, count });

			if count >= required {
				if c.era != era {
					c.era = era;
					c.admitted_in_era = 0;
				}
				ensure!(c.admitted_in_era < c.cap_per_era, Error::<T>::CommunityFull);
				c.admitted_in_era += 1;
				Communities::<T>::insert(community, c);
				Candidates::<T>::remove(&candidate);
				Self::admit(candidate, community, evidence, cand.witnesses, false);
			} else {
				Candidates::<T>::insert(&candidate, cand);
			}
			Ok(())
		}

		/// Register consensus keys and queue for a validator seat.
		#[pallet::call_index(1)]
		#[pallet::weight(Weight::from_parts(30_000_000, 0).saturating_add(T::DbWeight::get().reads_writes(3, 2)))]
		pub fn set_keys(origin: OriginFor<T>, keys: T::SessionKeys) -> DispatchResult {
			let who = ensure_signed(origin)?;
			ensure!(Members::<T>::contains_key(&who), Error::<T>::NotMember);
			Self::put_keys(&who, keys)?;
			Self::deposit_event(Event::KeysSet { who });
			Ok(())
		}

		/// Put a point forward for the knowledge graph, bonded in KAB. `digest`
		/// commits to the content, which stays off chain.
		#[pallet::call_index(2)]
		#[pallet::weight(Weight::from_parts(40_000_000, 0).saturating_add(T::DbWeight::get().reads_writes(4, 4)))]
		pub fn propose_point(origin: OriginFor<T>, digest: H256, bond: Kab, note: Vec<u8>) -> DispatchResult {
			let who = ensure_signed(origin)?;
			ensure!(Members::<T>::contains_key(&who), Error::<T>::NotMember);
			ensure!(bond >= T::MinBond::get(), Error::<T>::BondTooSmall);
			ensure!(!Points::<T>::contains_key(digest), Error::<T>::PointExists);
			let note: BoundedVec<u8, T::MaxNoteLen> = note.try_into().map_err(|_| Error::<T>::NoteTooLong)?;
			Self::debit(&who, bond)?;
			let now = frame_system::Pallet::<T>::block_number();
			let matures_at = now.saturating_add(T::MaturityPeriod::get().max(1).into());
			MaturingAt::<T>::try_mutate(matures_at, |due| due.try_push(digest))
				.map_err(|_| Error::<T>::MaturityFull)?;
			Points::<T>::insert(
				digest,
				Point {
					proposer: who.clone(),
					bond,
					proposed_at: now,
					matures_at,
					challengers: Default::default(),
					note,
					status: PointStatus::Pending,
				},
			);
			Self::deposit_event(Event::Proposed { digest, proposer: who, bond });
			Ok(())
		}

		/// Object to a pending point. Enough distinct objections forfeit its bond.
		#[pallet::call_index(3)]
		#[pallet::weight(Weight::from_parts(30_000_000, 0).saturating_add(T::DbWeight::get().reads_writes(3, 2)))]
		pub fn challenge(origin: OriginFor<T>, digest: H256) -> DispatchResult {
			let who = ensure_signed(origin)?;
			ensure!(Members::<T>::contains_key(&who), Error::<T>::NotMember);
			let mut p = Points::<T>::get(digest).ok_or(Error::<T>::NoSuchPoint)?;
			ensure!(p.status == PointStatus::Pending, Error::<T>::NotPending);
			ensure!(p.proposer != who, Error::<T>::OwnPoint);
			ensure!(!p.challengers.contains(&who), Error::<T>::AlreadyChallenged);
			p.challengers.try_push(who.clone()).map_err(|_| Error::<T>::NotPending)?;
			let count = p.challengers.len() as u32;
			Self::deposit_event(Event::Challenged { digest, by: who, count });
			if count >= T::ChallengeThreshold::get() {
				Self::forfeit(digest, &mut p);
			}
			Points::<T>::insert(digest, p);
			Ok(())
		}

		/// Open a motion. The proposer's aye is counted.
		#[pallet::call_index(4)]
		#[pallet::weight(Weight::from_parts(30_000_000, 0).saturating_add(T::DbWeight::get().reads_writes(5, 5)))]
		pub fn propose(origin: OriginFor<T>, kind: MotionKind<T>) -> DispatchResult {
			let who = ensure_signed(origin)?;
			let me = Members::<T>::get(&who).ok_or(Error::<T>::NotMember)?;
			ensure!(!OpenMotionOf::<T>::contains_key(&who), Error::<T>::OneMotionAtATime);
			let founding = FoundingActive::<T>::get();
			match &kind {
				MotionKind::Upgrade { .. } => {},
				MotionKind::OpenCommunity { cap_per_era } => ensure!(*cap_per_era > 0, Error::<T>::BadMotion),
				MotionKind::SetCap { community, .. } =>
					ensure!(Communities::<T>::contains_key(community), Error::<T>::NoSuchCommunity),
				MotionKind::Expel { who: target } =>
					ensure!(Members::<T>::contains_key(target), Error::<T>::NotMember),
				MotionKind::EndFounding => ensure!(founding, Error::<T>::FoundingOver),
			}
			let now = frame_system::Pallet::<T>::block_number();
			let id = NextMotionId::<T>::mutate(|n| {
				let id = *n;
				*n = n.saturating_add(1);
				id
			});
			let motion = Motion {
				kind: kind.clone(),
				proposer: who.clone(),
				by_founder: founding && me.founder,
				proposed_at: now,
				ends_at: now.saturating_add(T::VotingPeriod::get().into()),
				ayes: 1,
				nays: 0,
				electorate: MemberCount::<T>::get(),
				electorate_below: NextMemberIndex::<T>::get(),
			};
			Motions::<T>::insert(id, motion);
			Votes::<T>::insert(id, &who, true);
			OpenMotionOf::<T>::insert(&who, id);
			Self::deposit_event(Event::MotionOpened { id, proposer: who, kind });
			Ok(())
		}

		/// One member, one vote. A vote can be changed until the motion ends.
		#[pallet::call_index(5)]
		#[pallet::weight(Weight::from_parts(25_000_000, 0).saturating_add(T::DbWeight::get().reads_writes(3, 2)))]
		pub fn vote(origin: OriginFor<T>, id: MotionId, aye: bool) -> DispatchResult {
			let who = ensure_signed(origin)?;
			let me = Members::<T>::get(&who).ok_or(Error::<T>::NotMember)?;
			let mut m = Motions::<T>::get(id).ok_or(Error::<T>::NoSuchMotion)?;
			let now = frame_system::Pallet::<T>::block_number();
			ensure!(now < m.ends_at, Error::<T>::VotingClosed);
			ensure!(me.index < m.electorate_below, Error::<T>::NotInElectorate);
			match Votes::<T>::get(id, &who) {
				Some(prev) if prev == aye => return Ok(()),
				Some(true) => m.ayes = m.ayes.saturating_sub(1),
				Some(false) => m.nays = m.nays.saturating_sub(1),
				None => {},
			}
			if aye {
				m.ayes += 1
			} else {
				m.nays += 1
			}
			Votes::<T>::insert(id, &who, aye);
			Motions::<T>::insert(id, m);
			Self::deposit_event(Event::Voted { id, who, aye });
			Ok(())
		}

		/// Count a motion once its voting period is over, and carry it out if it passed.
		///
		/// A founder's motion (while founding control holds) passes unless a third
		/// of the electorate voted nay. Every other motion needs more than half the
		/// electorate voting aye and less than a third nay. Ending founding control
		/// needs a simple majority, and expelling a member is never on the founder rule.
		#[pallet::call_index(6)]
		#[pallet::weight(Weight::from_parts(60_000_000, 0).saturating_add(T::DbWeight::get().reads_writes(8, 8)))]
		pub fn close(origin: OriginFor<T>, id: MotionId) -> DispatchResult {
			let who = ensure_signed(origin)?;
			ensure!(Members::<T>::contains_key(&who), Error::<T>::NotMember);
			let m = Motions::<T>::get(id).ok_or(Error::<T>::NoSuchMotion)?;
			let now = frame_system::Pallet::<T>::block_number();
			ensure!(now >= m.ends_at, Error::<T>::VotingOpen);

			let vetoed = m.nays.saturating_mul(3) >= m.electorate.max(1);
			let majority = m.ayes.saturating_mul(2) > m.electorate;
			let founder_rule = m.by_founder &&
				FoundingActive::<T>::get() &&
				matches!(m.kind, MotionKind::Upgrade { .. } | MotionKind::OpenCommunity { .. } | MotionKind::SetCap { .. });
			let passed = match m.kind {
				MotionKind::EndFounding => majority && FoundingActive::<T>::get(),
				MotionKind::Expel { ref who } => majority && !vetoed && Members::<T>::contains_key(who),
				_ if founder_rule => !vetoed,
				_ => majority && !vetoed,
			};
			if passed {
				Self::enact(m.kind.clone());
			}
			Motions::<T>::remove(id);
			let _ = Votes::<T>::clear_prefix(id, u32::MAX, None);
			OpenMotionOf::<T>::remove(&m.proposer);
			Self::deposit_event(Event::MotionClosed {
				id,
				passed,
				ayes: m.ayes,
				nays: m.nays,
				electorate: m.electorate,
			});
			Ok(())
		}

		/// Move a snapshot balance from the old chain. Unsigned: the signature is
		/// from the old key, over `CLAIM_PREFIX ++ dest.encode()` (raw, or wrapped
		/// in `<Bytes>…</Bytes>` as browser wallets sign it).
		#[pallet::call_index(7)]
		#[pallet::weight(Weight::from_parts(80_000_000, 0).saturating_add(T::DbWeight::get().reads_writes(3, 3)))]
		pub fn claim(
			origin: OriginFor<T>,
			dest: T::AccountId,
			old: [u8; 32],
			signature: ClaimSignature,
		) -> DispatchResult {
			ensure_none(origin)?;
			ensure!(Self::claim_signature_ok(&dest, &old, &signature), Error::<T>::BadClaimSignature);
			let amount = Claims::<T>::take(old).ok_or(Error::<T>::NothingToClaim)?;
			Unclaimed::<T>::mutate(|u| *u = u.saturating_sub(amount));
			Balances::<T>::mutate(&dest, |b| *b = b.saturating_add(amount));
			Self::deposit_event(Event::Claimed { old, to: dest, amount });
			Ok(())
		}

		/// Move KAB to another member. KAB is a participation record, so it only
		/// moves between people inside the network.
		#[pallet::call_index(8)]
		#[pallet::weight(Weight::from_parts(25_000_000, 0).saturating_add(T::DbWeight::get().reads_writes(3, 2)))]
		pub fn transfer(origin: OriginFor<T>, to: T::AccountId, amount: Kab) -> DispatchResult {
			let from = ensure_signed(origin)?;
			ensure!(Members::<T>::contains_key(&from), Error::<T>::NotMember);
			ensure!(Members::<T>::contains_key(&to), Error::<T>::NotMember);
			Self::debit(&from, amount)?;
			Balances::<T>::mutate(&to, |b| *b = b.saturating_add(amount));
			Self::deposit_event(Event::Transferred { from, to, amount });
			Ok(())
		}
	}

	#[pallet::validate_unsigned]
	#[allow(deprecated)]
	impl<T: Config> ValidateUnsigned for Pallet<T> {
		type Call = Call<T>;

		fn validate_unsigned(_source: TransactionSource, call: &Self::Call) -> TransactionValidity {
			let Call::claim { dest, old, signature } = call else {
				return InvalidTransaction::Call.into();
			};
			if !Claims::<T>::contains_key(old) {
				return InvalidTransaction::Stale.into();
			}
			if !Self::claim_signature_ok(dest, old, signature) {
				return InvalidTransaction::BadProof.into();
			}
			ValidTransaction::with_tag_prefix("SeedsClaim")
				.and_provides(old)
				.longevity(64)
				.propagate(true)
				.build()
		}
	}

	// ------------------------------------------------------------ internals

	impl<T: Config> Pallet<T> {
		pub fn era() -> u32 {
			let n: u32 = frame_system::Pallet::<T>::block_number().unique_saturated_into();
			n / T::EraLength::get().max(1)
		}

		pub fn is_member(who: &T::AccountId) -> bool {
			Members::<T>::contains_key(who)
		}

		fn admit(
			who: T::AccountId,
			community: CommunityId,
			evidence: H256,
			witnesses: BoundedVec<T::AccountId, T::WitnessesRequired>,
			founder: bool,
		) {
			let index = NextMemberIndex::<T>::mutate(|n| {
				let i = *n;
				*n = n.saturating_add(1);
				i
			});
			Members::<T>::insert(
				&who,
				MemberRecord {
					index,
					community,
					admitted_at: frame_system::Pallet::<T>::block_number(),
					evidence,
					witnesses,
					founder,
					strikes: 0,
				},
			);
			MemberCount::<T>::mutate(|n| *n = n.saturating_add(1));
			Communities::<T>::mutate(community, |c| {
				if let Some(c) = c {
					c.members = c.members.saturating_add(1)
				}
			});
			// No balances pallet, so nothing else gives the account a provider, and
			// frame_system refuses a nonce from an account without one.
			frame_system::Pallet::<T>::inc_providers(&who);
			Self::deposit_event(Event::Admitted { who: who.clone(), community, index });
			Self::mint(&who, T::AdmissionMint::get(), MintReason::Admission);
		}

		/// The only place KAB comes into existence.
		fn mint(to: &T::AccountId, amount: Kab, reason: MintReason) {
			if amount == 0 {
				return;
			}
			Balances::<T>::mutate(to, |b| *b = b.saturating_add(amount));
			TotalIssuance::<T>::mutate(|t| *t = t.saturating_add(amount));
			Self::deposit_event(Event::Minted { to: to.clone(), amount, reason });
		}

		fn debit(who: &T::AccountId, amount: Kab) -> DispatchResult {
			Balances::<T>::try_mutate(who, |b| {
				*b = b.checked_sub(amount).ok_or(Error::<T>::InsufficientKab)?;
				Ok(())
			})
		}

		fn mature(digest: H256) {
			let Some(mut p) = Points::<T>::get(digest) else { return };
			if p.status != PointStatus::Pending {
				return;
			}
			if !Members::<T>::contains_key(&p.proposer) {
				Self::forfeit(digest, &mut p);
			} else {
				p.status = PointStatus::Matured;
				Balances::<T>::mutate(&p.proposer, |b| *b = b.saturating_add(p.bond));
				Self::mint(&p.proposer, T::MaturityMint::get(), MintReason::Maturity);
				Self::deposit_event(Event::Matured { digest, proposer: p.proposer.clone() });
			}
			Points::<T>::insert(digest, p);
		}

		/// The bond is burned: there is no treasury to send it to.
		fn forfeit(digest: H256, p: &mut Point<T>) {
			p.status = PointStatus::Forfeited;
			TotalIssuance::<T>::mutate(|t| *t = t.saturating_sub(p.bond));
			Self::deposit_event(Event::Forfeited { digest, burned: p.bond });
		}

		fn enact(kind: MotionKind<T>) {
			match kind {
				MotionKind::Upgrade { code_hash } =>
					frame_system::Pallet::<T>::do_authorize_upgrade(code_hash, true),
				MotionKind::OpenCommunity { cap_per_era } => {
					let id = NextCommunityId::<T>::mutate(|n| {
						let id = *n;
						*n = n.saturating_add(1);
						id
					});
					Communities::<T>::insert(id, Community { cap_per_era, ..Default::default() });
					Self::deposit_event(Event::CommunityOpened { id, cap_per_era });
				},
				MotionKind::SetCap { community, cap_per_era } => Communities::<T>::mutate(community, |c| {
					if let Some(c) = c {
						c.cap_per_era = cap_per_era
					}
				}),
				MotionKind::Expel { who } => Self::expel(who),
				MotionKind::EndFounding => {
					FoundingActive::<T>::put(false);
					Self::deposit_event(Event::FoundingEnded);
				},
			}
		}

		fn expel(who: T::AccountId) {
			let Some(rec) = Members::<T>::take(&who) else { return };
			for w in rec.witnesses.iter() {
				Members::<T>::mutate(w, |m| {
					if let Some(m) = m {
						m.strikes = m.strikes.saturating_add(1)
					}
				});
			}
			MemberCount::<T>::mutate(|n| *n = n.saturating_sub(1));
			Communities::<T>::mutate(rec.community, |c| {
				if let Some(c) = c {
					c.members = c.members.saturating_sub(1)
				}
			});
			Keys::<T>::remove(&who);
			KeyHolders::<T>::mutate(|h| h.retain(|a| a != &who));
			if let Some(id) = OpenMotionOf::<T>::take(&who) {
				Motions::<T>::remove(id);
				let _ = Votes::<T>::clear_prefix(id, u32::MAX, None);
			}
			let _ = frame_system::Pallet::<T>::dec_providers(&who);
			Self::deposit_event(Event::Expelled { who });
		}

		fn put_keys(who: &T::AccountId, keys: T::SessionKeys) -> DispatchResult {
			Keys::<T>::insert(who, keys);
			let mut holders = KeyHolders::<T>::get();
			if !holders.contains(who) {
				let index_of = |a: &T::AccountId| Members::<T>::get(a).map(|m| m.index).unwrap_or(u64::MAX);
				let mine = index_of(who);
				let at = holders.iter().position(|a| index_of(a) > mine).unwrap_or(holders.len());
				holders.try_insert(at, who.clone()).map_err(|_| Error::<T>::KeyHoldersFull)?;
				KeyHolders::<T>::put(holders);
			}
			Ok(())
		}

		fn seat_list() -> BoundedVec<(T::AccountId, T::SessionKeys), T::MaxValidators> {
			let seated: Vec<_> = KeyHolders::<T>::get()
				.into_iter()
				.filter_map(|a| Keys::<T>::get(&a).map(|k| (a, k)))
				.take(T::MaxValidators::get() as usize)
				.collect();
			BoundedVec::truncate_from(seated)
		}

		/// Hand consensus the oldest members with keys, if that differs from what it has.
		fn rotate_validators() -> Weight {
			let db = T::DbWeight::get();
			let holders = KeyHolders::<T>::decode_len().unwrap_or(0) as u64;
			let weight = db.reads(2 + holders * 2).saturating_add(db.writes(1));
			let next = Self::seat_list();
			if next.is_empty() || next == Validators::<T>::get() {
				return weight;
			}
			let keys: Vec<T::SessionKeys> = next.iter().map(|(_, k)| k.clone()).collect();
			if T::ValidatorSet::set(&keys) {
				let count = next.len() as u32;
				Validators::<T>::put(next);
				Self::deposit_event(Event::NewValidators { count });
			}
			weight
		}

		pub fn claim_signature_ok(dest: &T::AccountId, old: &[u8; 32], sig: &ClaimSignature) -> bool {
			let mut msg = CLAIM_PREFIX.to_vec();
			dest.encode_to(&mut msg);
			let mut wrapped = b"<Bytes>".to_vec();
			wrapped.extend_from_slice(&msg);
			wrapped.extend_from_slice(b"</Bytes>");
			match sig {
				ClaimSignature::Sr25519(s) => {
					let key = sr25519::Public::from_raw(*old);
					sp_io::crypto::sr25519_verify(s, &msg, &key) ||
						sp_io::crypto::sr25519_verify(s, &wrapped, &key)
				},
				ClaimSignature::Ed25519(s) => {
					let key = ed25519::Public::from_raw(*old);
					sp_io::crypto::ed25519_verify(s, &msg, &key) ||
						sp_io::crypto::ed25519_verify(s, &wrapped, &key)
				},
			}
		}
	}

	// --------------------------------------------------- the membership gate

	/// Refuses any signed transaction whose signer is not a member, before it
	/// reaches the pool. With no fees, this is the spam guard: the right to write
	/// is membership. Unsigned transactions (the claim) pass through to
	/// `ValidateUnsigned`.
	#[derive(Encode, Decode, DecodeWithMemTracking, frame_support::DefaultNoBound, Clone, Eq, PartialEq, TypeInfo)]
	#[scale_info(skip_type_params(T))]
	pub struct OnlyMembers<T>(core::marker::PhantomData<T>);

	impl<T: Config + Send + Sync> OnlyMembers<T> {
		pub fn new() -> Self {
			Self(core::marker::PhantomData)
		}
	}

	impl<T: Config + Send + Sync> core::fmt::Debug for OnlyMembers<T> {
		fn fmt(&self, f: &mut core::fmt::Formatter) -> core::fmt::Result {
			write!(f, "OnlyMembers")
		}
	}

	impl<T: Config + Send + Sync> frame_support::sp_runtime::traits::TransactionExtension<T::RuntimeCall>
		for OnlyMembers<T>
	{
		const IDENTIFIER: &'static str = "OnlyMembers";
		type Implicit = ();
		type Val = ();
		type Pre = ();

		fn weight(&self, _: &T::RuntimeCall) -> Weight {
			T::DbWeight::get().reads(1)
		}

		fn validate(
			&self,
			origin: T::RuntimeOrigin,
			_call: &T::RuntimeCall,
			_info: &frame_support::sp_runtime::traits::DispatchInfoOf<T::RuntimeCall>,
			_len: usize,
			_self_implicit: Self::Implicit,
			_inherited_implication: &impl Encode,
			_source: TransactionSource,
		) -> frame_support::sp_runtime::traits::ValidateResult<Self::Val, T::RuntimeCall> {
			if let Some(who) = origin.as_signer() {
				if !Members::<T>::contains_key(who) {
					return Err(InvalidTransaction::BadSigner.into());
				}
			}
			Ok((Default::default(), (), origin))
		}

		frame_support::sp_runtime::impl_tx_ext_default!(T::RuntimeCall; prepare);
	}
}
