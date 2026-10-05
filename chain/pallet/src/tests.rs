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
	pub const MaturityMint: u128 = 50;
	pub const MaxPendingPoints: u32 = 2;
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
		// Founding mints nothing: the only units are the snapshot's.
		assert_eq!(Balances::<Test>::get(A), 0);
		assert_eq!(TotalIssuance::<Test>::get(), 5_000);
		assert_eq!(Unclaimed::<Test>::get(), 5_000);
		assert_eq!(Validators::<Test>::get().to_vec(), vec![(A, 11), (B, 22)]);
		assert!(Members::<Test>::get(C).unwrap().founder);
		// Admission gives the account a provider, so frame_system accepts its nonce.
		assert_eq!(System::providers(&A), 1);
	});
}

// ---------------------------------------------------------------- admission

#[test]
fn two_witnesses_on_the_same_evidence_admit_and_mint_nothing() {
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
		assert_eq!(Balances::<Test>::get(10), 0);
		assert_eq!(TotalIssuance::<Test>::get(), 5_000);
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
fn an_unchallenged_point_matures_and_mints() {
	new_test_ext().execute_with(|| {
		let d = H256::repeat_byte(0xd1);
		assert_noop!(Seeds::propose_point(o(A), d, vec![0; 9]), Error::<Test>::NoteTooLong);
		assert_ok!(Seeds::propose_point(o(A), d, b"cs36".to_vec()));
		assert_eq!(Members::<Test>::get(A).unwrap().pending_points, 1);
		assert_noop!(Seeds::propose_point(o(B), d, vec![]), Error::<Test>::PointExists);
		assert_noop!(Seeds::challenge(o(A), d), Error::<Test>::OwnPoint);
		assert_ok!(Seeds::challenge(o(B), d));
		assert_noop!(Seeds::challenge(o(B), d), Error::<Test>::AlreadyChallenged);
		run_to(6);
		let p = Points::<Test>::get(d).unwrap();
		assert_eq!(p.status, PointStatus::Matured);
		assert_eq!(Balances::<Test>::get(A), 50);
		assert_eq!(TotalIssuance::<Test>::get(), 50 + 5_000);
		assert_eq!(Members::<Test>::get(A).unwrap().pending_points, 0);
		assert_noop!(Seeds::challenge(o(C), d), Error::<Test>::NotPending);
	});
}

#[test]
fn enough_challenges_fail_a_point_and_strike_its_proposer() {
	new_test_ext().execute_with(|| {
		let d = H256::repeat_byte(0xd2);
		assert_ok!(Seeds::propose_point(o(A), d, vec![]));
		assert_ok!(Seeds::challenge(o(B), d));
		assert_ok!(Seeds::challenge(o(C), d));
		assert_eq!(Points::<Test>::get(d).unwrap().status, PointStatus::Failed);
		let a = Members::<Test>::get(A).unwrap();
		assert_eq!((a.strikes, a.pending_points), (1, 0));
		run_to(6);
		assert_eq!(Balances::<Test>::get(A), 0);
		assert_eq!(TotalIssuance::<Test>::get(), 5_000);
	});
}

#[test]
fn a_member_holds_a_bounded_number_of_pending_points() {
	new_test_ext().execute_with(|| {
		assert_ok!(Seeds::propose_point(o(A), H256::repeat_byte(1), vec![]));
		run_to(2);
		assert_ok!(Seeds::propose_point(o(A), H256::repeat_byte(2), vec![]));
		run_to(3);
		assert_noop!(
			Seeds::propose_point(o(A), H256::repeat_byte(3), vec![]),
			Error::<Test>::TooManyPending
		);
	});
}

#[test]
fn a_struck_member_cannot_propose() {
	new_test_ext().execute_with(|| {
		Members::<Test>::mutate(A, |m| m.as_mut().unwrap().strikes = MaxStrikes::get());
		assert_noop!(Seeds::propose_point(o(A), H256::repeat_byte(1), vec![]), Error::<Test>::Struck);
	});
}

#[test]
fn a_block_holds_a_bounded_number_of_maturities() {
	new_test_ext().execute_with(|| {
		assert_ok!(Seeds::propose_point(o(A), H256::repeat_byte(1), vec![]));
		assert_ok!(Seeds::propose_point(o(B), H256::repeat_byte(2), vec![]));
		assert_noop!(
			Seeds::propose_point(o(C), H256::repeat_byte(3), vec![]),
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
		assert_ok!(Seeds::propose_point(o(10), H256::repeat_byte(5), vec![]));
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
		assert_eq!(Points::<Test>::get(H256::repeat_byte(5)).unwrap().status, PointStatus::Failed);
		assert_eq!(TotalIssuance::<Test>::get(), 5_000);
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

fn sign_claim(pair: &sr25519::Pair, dest: u64, wrap: bool) -> OwnershipProof {
	let mut msg = CLAIM_PREFIX.to_vec();
	System::block_hash(0).encode_to(&mut msg);
	dest.encode_to(&mut msg);
	if wrap {
		msg = [b"<Bytes>".as_slice(), &msg, b"</Bytes>"].concat();
	}
	OwnershipProof::Sr25519(pair.sign(&msg))
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
		assert_eq!(TotalIssuance::<Test>::get(), 5_000);
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
		assert!(Call::<Test>::challenge { digest: H256::zero() }
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
fn a_claim_signed_for_another_network_is_refused() {
	new_test_ext().execute_with(|| {
		let old = old_holder();
		let key = old.public().0;
		// The same destination, signed without this network's genesis hash.
		let mut msg = CLAIM_PREFIX.to_vec();
		H256::repeat_byte(0xab).encode_to(&mut msg);
		10u64.encode_to(&mut msg);
		assert_noop!(
			Seeds::claim(RuntimeOrigin::none(), 10, key, OwnershipProof::Sr25519(old.sign(&msg))),
			Error::<Test>::BadClaimSignature
		);
	});
}

// ------------------------------------------------------- ownership types

fn claim_msg(dest: u64) -> Vec<u8> {
	Pallet::<Test>::claim_message(&dest)
}

fn put_claim(id: [u8; 32], amount: Amount) {
	Claims::<Test>::insert(id, amount);
	Unclaimed::<Test>::mutate(|u| *u += amount);
}

struct Passkey(p256::ecdsa::SigningKey);

impl Passkey {
	fn new(seed: u8) -> Self {
		Self(p256::ecdsa::SigningKey::from_bytes(&[seed; 32].into()).unwrap())
	}
	fn public(&self) -> [u8; 33] {
		self.0.verifying_key().to_encoded_point(true).as_bytes().try_into().unwrap()
	}
	fn id(&self) -> [u8; 32] {
		ownership::passkey_id(&self.public())
	}
	/// What a browser hands back from `navigator.credentials.get`, with the
	/// challenge the chain expects for `msg`.
	fn assert(&self, msg: &[u8], kind: &str, flags: u8) -> OwnershipProof {
		use p256::ecdsa::signature::Signer;
		let challenge =
			String::from_utf8(ownership::base64url(&sp_io::hashing::sha2_256(msg))).unwrap();
		let cdj = format!(
			r#"{{"type":"{kind}","challenge":"{challenge}","origin":"https://birdbrain.wtf","crossOrigin":false}}"#
		)
		.into_bytes();
		let mut ad = sp_io::hashing::sha2_256(b"birdbrain.wtf").to_vec();
		ad.push(flags);
		ad.extend_from_slice(&[0, 0, 0, 1]);
		let mut signed = ad.clone();
		signed.extend_from_slice(&sp_io::hashing::sha2_256(&cdj));
		let sig: p256::ecdsa::Signature = self.0.sign(&signed);
		OwnershipProof::Passkey(ownership::PasskeyAssertion {
			public: self.public(),
			authenticator_data: ad.try_into().unwrap(),
			client_data_json: cdj.try_into().unwrap(),
			signature: sig.to_bytes().into(),
		})
	}
}

#[test]
fn base64url_is_unpadded_and_url_safe() {
	assert_eq!(ownership::base64url(b"hello"), b"aGVsbG8");
	assert_eq!(ownership::base64url(&[0xfb, 0xff]), b"-_8");
	assert_eq!(ownership::base64url(&[0u8; 32]).len(), 43);
}

#[test]
fn a_passkey_proves_its_own_id_and_nothing_else() {
	new_test_ext().execute_with(|| {
		let pk = Passkey::new(7);
		let msg = claim_msg(10);
		assert!(pk.assert(&msg, "webauthn.get", 0x05).proves(&pk.id(), &msg));
		// Signed for another destination.
		assert!(!pk.assert(&claim_msg(11), "webauthn.get", 0x05).proves(&pk.id(), &msg));
		// A registration ceremony, not an assertion.
		assert!(!pk.assert(&msg, "webauthn.create", 0x05).proves(&pk.id(), &msg));
		// The authenticator did not see the user.
		assert!(!pk.assert(&msg, "webauthn.get", 0x04).proves(&pk.id(), &msg));
		// Someone else's id.
		assert!(!pk.assert(&msg, "webauthn.get", 0x05).proves(&Passkey::new(8).id(), &msg));
		// Another key swapped into a valid assertion.
		let OwnershipProof::Passkey(mut a) = pk.assert(&msg, "webauthn.get", 0x05) else { panic!() };
		a.public = Passkey::new(8).public();
		assert!(!OwnershipProof::Passkey(a).proves(&Passkey::new(8).id(), &msg));
		// The raw P-256 key is not itself an id: the domain tag keeps the types apart.
		let raw: [u8; 32] = pk.public()[1..].try_into().unwrap();
		assert!(!pk.assert(&msg, "webauthn.get", 0x05).proves(&raw, &msg));
	});
}

#[test]
fn a_passkey_holder_claims_with_the_chip_signing() {
	new_test_ext().execute_with(|| {
		let pk = Passkey::new(7);
		put_claim(pk.id(), 700);
		assert_noop!(
			Seeds::claim(RuntimeOrigin::none(), 10, pk.id(), pk.assert(&claim_msg(11), "webauthn.get", 0x05)),
			Error::<Test>::BadClaimSignature
		);
		assert_ok!(Seeds::claim(RuntimeOrigin::none(), 10, pk.id(), pk.assert(&claim_msg(10), "webauthn.get", 0x05)));
		assert_eq!(Balances::<Test>::get(10), 700);
	});
}

#[test]
fn an_ecdsa_holder_claims_with_the_id_substrate_gave_them() {
	new_test_ext().execute_with(|| {
		let pair = sp_core::ecdsa::Pair::from_seed(&[3; 32]);
		let id = ownership::ecdsa_id(&pair.public().0);
		put_claim(id, 400);
		let wrapped = [b"<Bytes>".as_slice(), &claim_msg(10), b"</Bytes>"].concat();
		assert_noop!(
			Seeds::claim(RuntimeOrigin::none(), 10, id, OwnershipProof::Ecdsa(pair.sign(&claim_msg(11)))),
			Error::<Test>::BadClaimSignature
		);
		assert_ok!(Seeds::claim(RuntimeOrigin::none(), 10, id, OwnershipProof::Ecdsa(pair.sign(&wrapped))));
		assert_eq!(Balances::<Test>::get(10), 400);
	});
}

#[test]
fn a_passkey_claim_is_priced_above_a_plain_signature() {
	new_test_ext().execute_with(|| {
		let pk = Passkey::new(7);
		let sr = sign_claim(&old_holder(), 10, false);
		assert!(pk.assert(&claim_msg(10), "webauthn.get", 0x05).verify_weight().ref_time() > sr.verify_weight().ref_time());
	});
}
