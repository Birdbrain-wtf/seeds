//! Ownership proofs.
//!
//! An account here is a 32-byte id. The chain does not care which kind of key
//! stands behind it, only whether a proof shows control of that id for one
//! particular message. Each kind of key is an ownership type, a variant of
//! [`OwnershipProof`], and adding a scheme (a post-quantum one, say) is adding a
//! variant rather than moving anyone's balance.
//!
//! The idea is borrowed from Locus, an asset service on JAM:
//! `forum.polkadot.network/t/18868`. It governs who controls a balance. It says
//! nothing about who counts as a person, which stays with witnessed admission.
//!
//! | Type | The id is | Signed over |
//! | --- | --- | --- |
//! | Sr25519, Ed25519 | the public key | the message, raw or `<Bytes>`-wrapped |
//! | Ecdsa (secp256k1) | `blake2_256(compressed public key)`, as Substrate derives it | `blake2_256` of the message, raw or wrapped |
//! | Passkey (P-256 WebAuthn) | [`passkey_id`] of the compressed public key | a WebAuthn assertion whose challenge is `sha256(message)` |
//!
//! The passkey type means the key never leaves the phone's secure chip: the
//! chain checks the authenticator's own signature, with no PRF-derived sr25519
//! key in between.

use alloc::vec::Vec;
use codec::{Decode, DecodeWithMemTracking, Encode, MaxEncodedLen};
use frame_support::{traits::ConstU32, weights::Weight, BoundedVec};
use scale_info::TypeInfo;
use sp_core::{ecdsa, ed25519, sr25519};
use sp_io::hashing::{blake2_256, sha2_256};

pub type Id = [u8; 32];

pub const MAX_AUTHENTICATOR_DATA: u32 = 256;
pub const MAX_CLIENT_DATA_JSON: u32 = 1024;

/// Domain tag for passkey ids, so a P-256 key can never collide with an id of
/// another type.
pub const PASSKEY_ID_PREFIX: &[u8] = b"seeds/passkey-p256:";

/// The start every browser gives `clientDataJSON` for an assertion (WebAuthn
/// level 3, "limited verification"). The challenge follows it directly.
const CLIENT_DATA_PREFIX: &[u8] = b"{\"type\":\"webauthn.get\",\"challenge\":\"";

#[derive(Encode, Decode, DecodeWithMemTracking, Clone, PartialEq, Eq, Debug, TypeInfo, MaxEncodedLen)]
pub enum OwnershipProof {
	Sr25519(sr25519::Signature),
	Ed25519(ed25519::Signature),
	Ecdsa(ecdsa::Signature),
	Passkey(PasskeyAssertion),
}

/// What `navigator.credentials.get` returns, with the signature converted from
/// DER to 64 bytes `r ++ s`.
#[derive(Encode, Decode, DecodeWithMemTracking, Clone, PartialEq, Eq, Debug, TypeInfo, MaxEncodedLen)]
pub struct PasskeyAssertion {
	/// SEC1 compressed P-256 public key, from the credential's registration.
	pub public: [u8; 33],
	pub authenticator_data: BoundedVec<u8, ConstU32<MAX_AUTHENTICATOR_DATA>>,
	pub client_data_json: BoundedVec<u8, ConstU32<MAX_CLIENT_DATA_JSON>>,
	pub signature: [u8; 64],
}

pub fn passkey_id(public: &[u8; 33]) -> Id {
	let mut v = PASSKEY_ID_PREFIX.to_vec();
	v.extend_from_slice(public);
	blake2_256(&v)
}

pub fn ecdsa_id(public: &[u8; 33]) -> Id {
	blake2_256(public)
}

impl OwnershipProof {
	/// Whether this proof shows control of `id` for `msg`.
	pub fn proves(&self, id: &Id, msg: &[u8]) -> bool {
		let wrapped = wrap(msg);
		match self {
			Self::Sr25519(s) => {
				let key = sr25519::Public::from_raw(*id);
				sp_io::crypto::sr25519_verify(s, msg, &key) ||
					sp_io::crypto::sr25519_verify(s, &wrapped, &key)
			},
			Self::Ed25519(s) => {
				let key = ed25519::Public::from_raw(*id);
				sp_io::crypto::ed25519_verify(s, msg, &key) ||
					sp_io::crypto::ed25519_verify(s, &wrapped, &key)
			},
			Self::Ecdsa(s) => {
				let Ok(raw) = <[u8; 65]>::try_from(s.as_ref()) else { return false };
				[msg, &wrapped[..]].iter().any(|m| {
					sp_io::crypto::secp256k1_ecdsa_recover_compressed(&raw, &blake2_256(m))
						.map_or(false, |public| ecdsa_id(&public) == *id)
				})
			},
			Self::Passkey(a) => passkey_id(&a.public) == *id && a.verify(msg),
		}
	}

	/// Execution cost of [`Self::proves`]. P-256 runs in Wasm with no host
	/// function, so it is priced well above the others. Measured 1.6 ms under
	/// wasmtime on a machine scoring 106-108% of the reference CPU, flat across
	/// `clientDataJSON` sizes; priced at 2.5 ms for margin until a FRAME
	/// benchmark replaces it. Bench: `tools/passkey-bench/`.
	pub fn verify_weight(&self) -> Weight {
		let ref_time = match self {
			Self::Sr25519(_) | Self::Ed25519(_) => 2 * 60_000_000,
			Self::Ecdsa(_) => 2 * 80_000_000,
			Self::Passkey(_) => 2_500_000_000,
		};
		Weight::from_parts(ref_time, 0)
	}
}

impl PasskeyAssertion {
	fn verify(&self, msg: &[u8]) -> bool {
		use p256::ecdsa::{signature::hazmat::PrehashVerifier, Signature, VerifyingKey};

		let ad = &self.authenticator_data[..];
		// rpIdHash (32) ++ flags (1) ++ counter (4); flag bit 0 is "user present".
		if ad.len() < 37 || ad[32] & 0x01 == 0 {
			return false
		}
		let mut expected = CLIENT_DATA_PREFIX.to_vec();
		expected.extend_from_slice(&base64url(&sha2_256(msg)));
		expected.push(b'"');
		if !self.client_data_json.starts_with(&expected) {
			return false
		}
		let mut signed = ad.to_vec();
		signed.extend_from_slice(&sha2_256(&self.client_data_json));
		let Ok(key) = VerifyingKey::from_sec1_bytes(&self.public) else { return false };
		let Ok(sig) = Signature::from_slice(&self.signature) else { return false };
		let sig = sig.normalize_s().unwrap_or(sig);
		key.verify_prehash(&sha2_256(&signed), &sig).is_ok()
	}
}

/// How browser wallets sign a message: `<Bytes>…</Bytes>`.
fn wrap(msg: &[u8]) -> Vec<u8> {
	let mut v = b"<Bytes>".to_vec();
	v.extend_from_slice(msg);
	v.extend_from_slice(b"</Bytes>");
	v
}

/// Unpadded base64url, the encoding WebAuthn uses for the challenge.
pub fn base64url(data: &[u8]) -> Vec<u8> {
	const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	let mut out = Vec::with_capacity((data.len() * 4 + 2) / 3);
	for chunk in data.chunks(3) {
		let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
		let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
		for i in 0..=chunk.len() {
			out.push(T[(n >> (18 - 6 * i) & 63) as usize]);
		}
	}
	out
}
