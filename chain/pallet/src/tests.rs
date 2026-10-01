use crate as pallet_seeds;
use crate::*;
use core::cell::RefCell;
use frame_support::{
	assert_noop, assert_ok, derive_impl, parameter_types,
	traits::{Hooks, UnfilteredDispatchable},
};
use sp_core::{sr25519, Encode, Pair, H256};
use sp_runtime::{
	traits::{DispatchTransaction, Hash, TransactionExtension},
	transaction_validity::{InvalidTransaction, TransactionSource, TransactionValidityError},
	BuildStorage,
};

type Block = frame_system::mocking::MockBlock<Test>;

frame_support::construct_runtime!(
	pub enum Test {
		System: frame_system,
		Seeds: pallet_seeds,
	}
);

#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Test {
	type Block = Block;
}

thread_local! {
	static APPLIED: RefCell<Vec<Vec<u64>>> = RefCell::new(vec![]);
	static ACCEPT: RefCell<bool> = RefCell::new(true);
}

pub struct RecordSet;
impl ValidatorSet<u64> for RecordSet {
	fn set(keys: &[u64]) -> bool {
		let ok = ACCEPT.with(|a| *a.borrow());
		if ok {
			APPLIED.with(|v| v.borrow_mut().push(keys.to_vec()));
		}
		ok
	}
}

parameter_types! {
	pub const EraLength: u32 = 10;
	pub const WitnessesRequired: u32 = 2;
	pub const WitnessAllowance: u32 = 2;
	pub const CandidacyTimeout: u32 = 5;
	pub const MaxStrikes: u32 = 2;
	pub const AdmissionMint: u128 = 100;
	pub const MaturityMint: u128 = 50;
	pub const MinBond: u128 = 10;
	pub const MaturityPeriod: u32 = 5;
	pub const ChallengeThreshold: u32 = 2;
	pub const MaxMaturingPerBlock: u32 = 2;
	pub const MaxNoteLen: u32 = 8;
	pub const VotingPeriod: u32 = 3;
	pub const MaxValidators: u32 = 2;
	pub const MaxKeyHolders: u32 = 4;
}

impl pallet_seeds::Config for Test {
	type RuntimeEvent = RuntimeEvent;
	type SessionKeys = u64;
	type ValidatorSet = RecordSet;
	type EraLength = EraLength;
	type WitnessesRequired = WitnessesRequired;
	type WitnessAllowance = WitnessAllowance;
	type CandidacyTimeout = CandidacyTimeout;
	type MaxStrikes = MaxStrikes;
	type AdmissionMint = AdmissionMint;
	type MaturityMint = MaturityMint;
	type MinBond = MinBond;
	type MaturityPeriod = MaturityPeriod;
	type ChallengeThreshold = ChallengeThreshold;
	type MaxMaturingPerBlock = MaxMaturingPerBlock;
	type MaxNoteLen = MaxNoteLen;
	type VotingPeriod = VotingPeriod;
	type MaxValidators = MaxValidators;
	type MaxKeyHolders = MaxKeyHolders;
}

const A: u64 = 1; // founder, validator
const B: u64 = 2; // founder, validator
const C: u64 = 3; // founder, no keys
const EV: H256 = H256::repeat_byte(0xe1);

fn old_holder() -> sr25519::Pair {
	sr25519::Pair::from_seed(&[7u8; 32])
}

fn new_test_ext() -> sp_io::TestExternalities {
	APPLIED.with(|v| v.borrow_mut().clear());
	ACCEPT.with(|a| *a.borrow_mut() = true);
	let mut t = frame_system::GenesisConfig::<Test>::default().build_storage().unwrap();
	pallet_seeds::GenesisConfig::<Test> {
		founders: vec![(A, Some(11)), (B, Some(22)), (C, None)],
		founding_cap: 3,
		claims: vec![(old_holder().public().0, 5_000)],
	}
	.assimilate_storage(&mut t)
	.unwrap();
	let mut ext = sp_io::TestExternalities::new(t);
	ext.execute_with(|| System::set_block_number(1));
	ext
}

fn run_to(n: u64) {
	while System::block_number() < n {
		let next = System::block_number() + 1;
		System::set_block_number(next);
		Seeds::on_initialize(next);
	}
}

fn o(who: u64) -> RuntimeOrigin {
	RuntimeOrigin::signed(who)
}

fn admit(candidate: u64, community: CommunityId, witnesses: [u64; 2]) {
	for w in witnesses {
		assert_ok!(Seeds::witness(o(w), candidate, community, EV));
	}
	assert!(Seeds::is_member(&candidate));
}

fn motion(who: u64, kind: MotionKind<Test>) -> MotionId {
	assert_ok!(Seeds::propose(o(who), kind));
	NextMotionId::<Test>::get() - 1
}

fn close_after_voting(id: MotionId) {
	run_to(System::block_number() + VotingPeriod::get() as u64);
	assert_ok!(Seeds::close(o(A), id));
}

fn last_closed() -> bool {
	System::events()
		.into_iter()
		.rev()
		.find_map(|r| match r.event {
			RuntimeEvent::Seeds(Event::MotionClosed { passed, .. }) => Some(passed),
			_ => None,
		})
		.unwrap()
}

// ------------------------------------------------------------------ genesis

#[test]
fn genesis_founds_the_network() {
	new_test_ext().execute_with(|| {
		assert_eq!(MemberCount::<Test>::get(), 3);
		assert!(FoundingActive::<Test>::get());
		assert_eq!(Balances::<Test>::get(A), 100);
		assert_eq!(TotalIssuance::<Test>::get(), 300 + 5_000);
		assert_eq!(Unclaimed::<Test>::get(), 5_000);
		assert_eq!(Validators::<Test>::get().to_vec(), vec![(A, 11), (B, 22)]);
		assert!(Members::<Test>::get(C).unwrap().founder);
		// Admission gives the account a provider, so frame_system accepts its nonce.
		assert_eq!(System::providers(&A), 1);
	});
}

// ---------------------------------------------------------------- admission

#[test]
fn two_witnesses_on_the_same_evidence_admit_and_mint() {
	new_test_ext().execute_with(|| {
		assert_ok!(Seeds::witness(o(A), 10, 0, EV));
		assert!(!Seeds::is_member(&10));
		assert_noop!(Seeds::witness(o(A), 10, 0, EV), Error::<Test>::AlreadyWitnessed);
		assert_noop!(
			Seeds::witness(o(B), 10, 0, H256::repeat_byte(9)),
			Error::<Test>::CandidacyMismatch
		);
		assert_ok!(Seeds::witness(o(B), 10, 0, EV));
		let m = Members::<Test>::get(10).unwrap();
		assert_eq!((m.index, m.community, m.evidence), (3, 0, EV));
		assert_eq!(m.witnesses.to_vec(), vec![A, B]);
		assert_eq!(Balances::<Test>::get(10), 100);
		assert_eq!(TotalIssuance::<Test>::get(), 400 + 5_000);
		assert_eq!(System::providers(&10), 1);
		assert_noop!(Seeds::witness(o(C), 10, 0, EV), Error::<Test>::AlreadyMember);
	});
}

#[test]
fn outsiders_cannot_witness() {
	new_test_ext().execute_with(|| {
		assert_noop!(Seeds::witness(o(99), 10, 0, EV), Error::<Test>::NotMember);
		assert_noop!(Seeds::witness(o(A), 10, 7, EV), Error::<Test>::NoSuchCommunity);
	});
}

#[test]
fn a_candidacy_lapses_and_can_restart() {
	new_test_ext().execute_with(|| {
		assert_ok!(Seeds::witness(o(A), 10, 0, EV));
		run_to(1 + CandidacyTimeout::get() as u64);
		// Old candidacy lapsed, so a new one with different evidence is allowed.
		assert_ok!(Seeds::witness(o(B), 10, 0, H256::repeat_byte(9)));
		assert!(!Seeds::is_member(&10));
		assert_eq!(Candidates::<Test>::get(10).unwrap().witnesses.to_vec(), vec![B]);
	});
}

#[test]
fn witness_allowance_is_per_era() {
	new_test_ext().execute_with(|| {
		assert_ok!(Seeds::witness(o(A), 10, 0, EV));
		assert_ok!(Seeds::witness(o(A), 11, 0, EV));
		assert_noop!(Seeds::witness(o(A), 12, 0, EV), Error::<Test>::AllowanceSpent);
		run_to(10);
		assert_ok!(Seeds::witness(o(A), 12, 0, EV));
	});
}

#[test]
fn community_cap_is_per_era() {
	new_test_ext().execute_with(|| {
		admit(10, 0, [A, B]);
		admit(11, 0, [A, C]);
		admit(12, 0, [B, C]);
		assert_ok!(Seeds::witness(o(10), 13, 0, EV));
		assert_noop!(Seeds::witness(o(11), 13, 0, EV), Error::<Test>::CommunityFull);
		run_to(10);
		// The old candidacy has lapsed, so it takes two fresh witnesses.
		assert_ok!(Seeds::witness(o(11), 13, 0, EV));
		assert_ok!(Seeds::witness(o(12), 13, 0, EV));
		assert!(Seeds::is_member(&13));
	});
}

#[test]
fn a_new_community_is_sponsored_then_witnesses_for_itself() {
	new_test_ext().execute_with(|| {
		let id = motion(A, MotionKind::OpenCommunity { cap_per_era: 5 });
		close_after_voting(id);
		assert!(last_closed());
		let c = Communities::<Test>::get(1).unwrap();
		assert_eq!((c.cap_per_era, c.members), (5, 0));
		// Empty community: the network sponsors its first members.
		admit(20, 1, [A, B]);
		admit(21, 1, [A, C]);
		// Now it has enough of its own, and outsiders are refused.
		assert_noop!(Seeds::witness(o(B), 22, 1, EV), Error::<Test>::OutsideWitness);
		admit(22, 1, [20, 21]);
		assert_eq!(Members::<Test>::get(22).unwrap().community, 1);
	});
}

// ------------------------------------------------------------------- points

#[test]
fn an_unchallenged_point_matures_returns_the_bond_and_mints() {
	new_test_ext().execute_with(|| {
		let d = H256::repeat_byte(0xd1);
		assert_noop!(Seeds::propose_point(o(A), d, 9, vec![]), Error::<Test>::BondTooSmall);
		assert_noop!(Seeds::propose_point(o(A), d, 101, vec![]), Error::<Test>::InsufficientKab);
		assert_noop!(Seeds::propose_point(o(A), d, 10, vec![0; 9]), Error::<Test>::NoteTooLong);
		assert_ok!(Seeds::propose_point(o(A), d, 40, b"cs36".to_vec()));
		assert_eq!(Balances::<Test>::get(A), 60);
		assert_noop!(Seeds::propose_point(o(B), d, 10, vec![]), Error::<Test>::PointExists);
		assert_noop!(Seeds::challenge(o(A), d), Error::<Test>::OwnPoint);
		assert_ok!(Seeds::challenge(o(B), d));
		assert_noop!(Seeds::challenge(o(B), d), Error::<Test>::AlreadyChallenged);
		run_to(6);
		let p = Points::<Test>::get(d).unwrap();
		assert_eq!(p.status, PointStatus::Matured);
		assert_eq!(Balances::<Test>::get(A), 100 + 50);
		assert_eq!(TotalIssuance::<Test>::get(), 300 + 50 + 5_000);
		assert_noop!(Seeds::challenge(o(C), d), Error::<Test>::NotPending);
	});
}

#[test]
fn enough_challenges_burn_the_bond() {
	new_test_ext().execute_with(|| {
		let d = H256::repeat_byte(0xd2);
		assert_ok!(Seeds::propose_point(o(A), d, 40, vec![]));
		assert_ok!(Seeds::challenge(o(B), d));
		assert_ok!(Seeds::challenge(o(C), d));
		assert_eq!(Points::<Test>::get(d).unwrap().status, PointStatus::Forfeited);
		run_to(6);
		assert_eq!(Balances::<Test>::get(A), 60);
		assert_eq!(TotalIssuance::<Test>::get(), 300 - 40 + 5_000);
	});
}

#[test]
fn a_block_holds_a_bounded_number_of_maturities() {
	new_test_ext().execute_with(|| {
		assert_ok!(Seeds::propose_point(o(A), H256::repeat_byte(1), 10, vec![]));
		assert_ok!(Seeds::propose_point(o(B), H256::repeat_byte(2), 10, vec![]));
		assert_noop!(
			Seeds::propose_point(o(C), H256::repeat_byte(3), 10, vec![]),
			Error::<Test>::MaturityFull
		);
	});
}

// ------------------------------------------------------------------ motions

#[test]
fn a_founders_upgrade_passes_unless_a_third_object() {
	new_test_ext().execute_with(|| {
		let code_hash = <Test as frame_system::Config>::Hashing::hash(b"new runtime");
		let id = motion(A, MotionKind::Upgrade { code_hash });
		close_after_voting(id);
		assert!(last_closed());
		System::assert_has_event(
			frame_system::Event::UpgradeAuthorized { code_hash, check_version: true }.into(),
		);

		let id = motion(A, MotionKind::Upgrade { code_hash });
		assert_ok!(Seeds::vote(o(C), id, false)); // 1 of 3 is a third
		close_after_voting(id);
		assert!(!last_closed());
	});
}

#[test]
fn a_members_upgrade_needs_a_majority() {
	new_test_ext().execute_with(|| {
		admit(10, 0, [A, B]);
		let code_hash = H256::repeat_byte(0xc0);
		let id = motion(10, MotionKind::Upgrade { code_hash });
		close_after_voting(id);
		assert!(!last_closed()); // 1 of 4
		let id = motion(10, MotionKind::Upgrade { code_hash });
		assert_ok!(Seeds::vote(o(A), id, true));
		assert_ok!(Seeds::vote(o(B), id, true));
		close_after_voting(id);
		assert!(last_closed()); // 3 of 4
	});
}

#[test]
fn members_end_founding_control_and_founders_lose_the_veto_rule() {
	new_test_ext().execute_with(|| {
		admit(10, 0, [A, B]);
		admit(11, 0, [A, C]);
		let id = motion(10, MotionKind::EndFounding);
		assert_ok!(Seeds::vote(o(11), id, true));
		assert_ok!(Seeds::vote(o(C), id, true));
		assert_ok!(Seeds::vote(o(A), id, false));
		close_after_voting(id);
		assert!(last_closed()); // 3 of 5
		assert!(!FoundingActive::<Test>::get());
		assert_noop!(Seeds::propose(o(A), MotionKind::EndFounding), Error::<Test>::FoundingOver);
		// A founder's upgrade with no objections now fails: it needs a majority.
		let id = motion(A, MotionKind::Upgrade { code_hash: H256::zero() });
		assert!(!Motions::<Test>::get(id).unwrap().by_founder);
		close_after_voting(id);
		assert!(!last_closed());
	});
}

#[test]
fn voting_rules() {
	new_test_ext().execute_with(|| {
		let id = motion(A, MotionKind::Upgrade { code_hash: H256::zero() });
		assert_noop!(
			Seeds::propose(o(A), MotionKind::EndFounding),
			Error::<Test>::OneMotionAtATime
		);
		assert_noop!(Seeds::close(o(B), id), Error::<Test>::VotingOpen);
		admit(10, 0, [B, C]);
		assert_noop!(Seeds::vote(o(10), id, true), Error::<Test>::NotInElectorate);
		assert_ok!(Seeds::vote(o(B), id, false));
		assert_ok!(Seeds::vote(o(B), id, true)); // changed
		let m = Motions::<Test>::get(id).unwrap();
		assert_eq!((m.ayes, m.nays, m.electorate), (2, 0, 3));
		run_to(System::block_number() + 3);
		assert_noop!(Seeds::vote(o(C), id, true), Error::<Test>::VotingClosed);
		assert_ok!(Seeds::close(o(B), id));
		assert!(OpenMotionOf::<Test>::get(A).is_none());
		assert_eq!(Votes::<Test>::iter_prefix(id).count(), 0);
	});
}

// --------------------------------------------------------------- expulsion

#[test]
fn expelling_strikes_the_witnesses_and_forfeits_pending_points() {
	new_test_ext().execute_with(|| {
		admit(10, 0, [A, B]);
		assert_ok!(Seeds::propose_point(o(10), H256::repeat_byte(5), 20, vec![]));
		let id = motion(C, MotionKind::Expel { who: 10 });
		assert_ok!(Seeds::vote(o(A), id, true));
		assert_ok!(Seeds::vote(o(B), id, true));
		close_after_voting(id);
		assert!(last_closed());
		assert!(!Seeds::is_member(&10));
		assert_eq!(MemberCount::<Test>::get(), 3);
		assert_eq!(Members::<Test>::get(A).unwrap().strikes, 1);
		assert_eq!(Members::<Test>::get(B).unwrap().strikes, 1);
		assert_eq!(Members::<Test>::get(C).unwrap().strikes, 0);
		run_to(10);
		assert_eq!(Points::<Test>::get(H256::repeat_byte(5)).unwrap().status, PointStatus::Forfeited);
	});
}

#[test]
fn a_witness_with_enough_strikes_is_stood_down() {
	new_test_ext().execute_with(|| {
		Members::<Test>::mutate(A, |m| m.as_mut().unwrap().strikes = MaxStrikes::get());
		assert_noop!(Seeds::witness(o(A), 10, 0, EV), Error::<Test>::Struck);
	});
}

// --------------------------------------------------------------- validators

#[test]
fn seats_go_to_the_oldest_members_with_keys_each_era() {
	new_test_ext().execute_with(|| {
		admit(10, 0, [A, B]);
		assert_ok!(Seeds::set_keys(o(10), 100));
		assert_noop!(Seeds::set_keys(o(99), 1), Error::<Test>::NotMember);
		run_to(10);
		// Two seats, A and B are older: nothing changes.
		assert!(APPLIED.with(|v| v.borrow().is_empty()));

		let id = motion(C, MotionKind::Expel { who: B });
		assert_ok!(Seeds::vote(o(10), id, true));
		assert_ok!(Seeds::vote(o(A), id, true));
		close_after_voting(id);
		assert!(last_closed());
		run_to(20);
		assert_eq!(APPLIED.with(|v| v.borrow().clone()), vec![vec![11, 100]]);
		assert_eq!(Validators::<Test>::get().to_vec(), vec![(A, 11), (10, 100)]);
	});
}

#[test]
fn a_refused_change_is_retried_next_era() {
	new_test_ext().execute_with(|| {
		assert_ok!(Seeds::set_keys(o(A), 12)); // rotate A's keys
		ACCEPT.with(|a| *a.borrow_mut() = false);
		run_to(10);
		assert_eq!(Validators::<Test>::get().to_vec(), vec![(A, 11), (B, 22)]);
		ACCEPT.with(|a| *a.borrow_mut() = true);
		run_to(20);
		assert_eq!(Validators::<Test>::get().to_vec(), vec![(A, 12), (B, 22)]);
	});
}

// ------------------------------------------------------------------- claims

fn sign_claim(pair: &sr25519::Pair, dest: u64, wrap: bool) -> ClaimSignature {
	let mut msg = CLAIM_PREFIX.to_vec();
	dest.encode_to(&mut msg);
	if wrap {
		msg = [b"<Bytes>".as_slice(), &msg, b"</Bytes>"].concat();
	}
	ClaimSignature::Sr25519(pair.sign(&msg))
}

#[test]
fn an_old_holder_claims_with_their_old_key() {
	new_test_ext().execute_with(|| {
		let old = old_holder();
		let key = old.public().0;
		// Signed for someone else: refused.
		assert_noop!(
			Seeds::claim(RuntimeOrigin::none(), 10, key, sign_claim(&old, 11, false)),
			Error::<Test>::BadClaimSignature
		);
		assert_noop!(
			Seeds::claim(o(A), 10, key, sign_claim(&old, 10, false)),
			sp_runtime::DispatchError::BadOrigin
		);
		assert_ok!(Seeds::claim(RuntimeOrigin::none(), 10, key, sign_claim(&old, 10, true)));
		assert_eq!(Balances::<Test>::get(10), 5_000);
		assert_eq!(Unclaimed::<Test>::get(), 0);
		// Claiming moves the snapshot, it is not a mint.
		assert_eq!(TotalIssuance::<Test>::get(), 300 + 5_000);
		assert_noop!(
			Seeds::claim(RuntimeOrigin::none(), 10, key, sign_claim(&old, 10, false)),
			Error::<Test>::NothingToClaim
		);
	});
}

#[test]
#[allow(deprecated)]
fn the_pool_only_takes_valid_claims() {
	use frame_support::unsigned::ValidateUnsigned;
	new_test_ext().execute_with(|| {
		let old = old_holder();
		let key = old.public().0;
		let good = Call::<Test>::claim { dest: 10, old: key, signature: sign_claim(&old, 10, false) };
		let forged = Call::<Test>::claim { dest: 10, old: key, signature: sign_claim(&old, 11, false) };
		let absent = Call::<Test>::claim { dest: 10, old: [0; 32], signature: sign_claim(&old, 10, false) };
		assert!(Seeds::validate_unsigned(TransactionSource::External, &good).is_ok());
		assert_eq!(
			Seeds::validate_unsigned(TransactionSource::External, &forged),
			InvalidTransaction::BadProof.into()
		);
		assert_eq!(
			Seeds::validate_unsigned(TransactionSource::External, &absent),
			InvalidTransaction::Stale.into()
		);
		// Unsigned dispatch of anything else is refused outright.
		assert!(Call::<Test>::transfer { to: A, amount: 1 }
			.dispatch_bypass_filter(RuntimeOrigin::none())
			.is_err());
	});
}

// ------------------------------------------------------------ the gate

#[test]
fn only_members_may_sign() {
	new_test_ext().execute_with(|| {
		let call: RuntimeCall = Call::<Test>::challenge { digest: H256::zero() }.into();
		let info = Default::default();
		let gate = OnlyMembers::<Test>::new();
		assert_eq!(
			gate.validate_only(Some(99).into(), &call, &info, 0, TransactionSource::External, 0)
				.unwrap_err(),
			TransactionValidityError::from(InvalidTransaction::BadSigner)
		);
		assert_ok!(gate.validate_only(Some(A).into(), &call, &info, 0, TransactionSource::External, 0));
		// Unsigned passes the gate and is left to ValidateUnsigned.
		assert!(gate
			.validate(RuntimeOrigin::none(), &call, &info, 0, (), &sp_runtime::traits::TxBaseImplication(()), TransactionSource::External)
			.is_ok());
	});
}

#[test]
fn kab_moves_only_between_members() {
	new_test_ext().execute_with(|| {
		assert_noop!(Seeds::transfer(o(A), 99, 10), Error::<Test>::NotMember);
		assert_noop!(Seeds::transfer(o(A), B, 101), Error::<Test>::InsufficientKab);
		assert_ok!(Seeds::transfer(o(A), B, 30));
		assert_eq!((Balances::<Test>::get(A), Balances::<Test>::get(B)), (70, 130));
	});
}
