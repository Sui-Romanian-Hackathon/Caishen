import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider,
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient
} from '@mysten/dapp-kit';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import {
  generateNonce,
  generateRandomness,
  genAddressSeed,
  getExtendedEphemeralPublicKey,
  getZkLoginSignature,
  jwtToAddress
} from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { useEffect, useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LinkPage } from './LinkPage';
import './app-layout.css';
import './link-page.css';

// Configuration from environment variables (build-time)
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const PROVER_URL = import.meta.env.VITE_ZKLOGIN_PROVER_URL || 'https://prover-dev.mystenlabs.com/v1';
const SALT_SERVICE_URL = import.meta.env.VITE_ZKLOGIN_SALT_SERVICE_URL || 'https://salt.api.mystenlabs.com/get_salt';
const SUI_NETWORK = import.meta.env.VITE_SUI_NETWORK || 'testnet';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://caishen.iseethereaper.com';
const REDIRECT_URI = typeof window !== 'undefined' ? `${window.location.origin}/callback` : '';

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') }
});

const queryClient = new QueryClient();

export function App() {
  // Simple path-based routing
  const isLinkPage = window.location.pathname.startsWith('/link');

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={SUI_NETWORK as 'testnet' | 'mainnet'}>
        <WalletProvider autoConnect>
          {isLinkPage ? <LinkPage /> : <Page />}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

function Page() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute, isPending } = useSignAndExecuteTransaction();

  // Pending transaction ID from URL (secure flow from Telegram bot)
  const [pendingTxId, setPendingTxId] = useState<string | null>(() => {
    const url = new URL(window.location.href);
    return url.searchParams.get('tx');
  });
  const [pendingTxLoading, setPendingTxLoading] = useState(false);
  const [pendingTxError, setPendingTxError] = useState<string | null>(null);
  const [pendingTxExpiry, setPendingTxExpiry] = useState<number | null>(null);

  // Form state
  const [form, setForm] = useState(() => {
    const url = new URL(window.location.href);
    return {
      recipient: url.searchParams.get('recipient') || '',
      amount: url.searchParams.get('amount') || '',
      memo: url.searchParams.get('memo') || ''
    };
  });
  const [status, setStatus] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'wallet' | 'zklogin'>(() => {
    const url = new URL(window.location.href);
    return url.searchParams.get('mode') === 'zklogin' ? 'zklogin' : 'wallet';
  });
  const [senderParam] = useState(() => {
    const url = new URL(window.location.href);
    return url.searchParams.get('sender') || '';
  });

  // zkLogin state
  const [jwtToken, setJwtToken] = useState(() => {
    // Check URL hash for OAuth callback (id_token in fragment)
    const hash = window.location.hash;
    if (hash.includes('id_token=')) {
      const match = hash.match(/id_token=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
    return '';
  });
  const [salt, setSalt] = useState('');
  // Use configuration from environment (not exposed in URL)
  const proverUrl = PROVER_URL;
  const saltServiceUrl = SALT_SERVICE_URL;
  const [zkStatus, setZkStatus] = useState<string | null>(null);
  const [zkError, setZkError] = useState<string | null>(null);
  const [zkDigest, setZkDigest] = useState<string | null>(null);

  // Gas estimation state
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);
  const [zkAddress, setZkAddress] = useState<string | null>(null);

  // Ephemeral key stored for OAuth callback flow
  const [ephemeralKeypair, setEphemeralKeypair] = useState<Ed25519Keypair | null>(null);
  const [oauthNonce, setOauthNonce] = useState<string | null>(null);
  const [maxEpoch, setMaxEpoch] = useState<number | null>(null);
  const [randomness, setRandomness] = useState<string | null>(null);

  // Clear hash after reading JWT from OAuth callback
  useEffect(() => {
    if (window.location.hash.includes('id_token=')) {
      window.history.replaceState({}, '', window.location.pathname + window.location.search);
    }
  }, []);

  // Fetch pending transaction details from API (secure flow)
  useEffect(() => {
    if (!pendingTxId) return;

    const fetchPendingTx = async () => {
      setPendingTxLoading(true);
      setPendingTxError(null);

      try {
        const res = await fetch(`${API_BASE_URL}/api/pending-tx/${pendingTxId}`);

        if (!res.ok) {
          if (res.status === 404) {
            setPendingTxError('Transaction link expired or invalid. Please request a new one from the bot.');
          } else {
            setPendingTxError(`Failed to load transaction: ${res.status}`);
          }
          return;
        }

        const data = await res.json();

        // Populate form with fetched data
        setForm({
          recipient: data.recipient || '',
          amount: String(data.amount) || '',
          memo: data.memo || ''
        });
        setMode(data.mode || 'wallet');
        if (data.salt) setSalt(data.salt);
        if (data.expiresAt) setPendingTxExpiry(data.expiresAt);

        // Clean URL after loading (remove tx param)
        const url = new URL(window.location.href);
        url.searchParams.delete('tx');
        window.history.replaceState({}, '', url.toString());

      } catch (err) {
        setPendingTxError(err instanceof Error ? err.message : 'Failed to load transaction');
      } finally {
        setPendingTxLoading(false);
      }
    };

    fetchPendingTx();
  }, [pendingTxId]);

  // Derive zkLogin address when JWT changes
  useEffect(() => {
    if (jwtToken && salt) {
      try {
        const addr = jwtToAddress(jwtToken, salt);
        setZkAddress(addr);
      } catch {
        setZkAddress(null);
      }
    } else {
      setZkAddress(null);
    }
  }, [jwtToken, salt]);

  // Estimate gas when form changes
  useEffect(() => {
    const estimateGas = async () => {
      const amountNum = Number(form.amount);
      if (!form.recipient || !amountNum || amountNum <= 0) {
        setGasEstimate(null);
        return;
      }
      try {
        const gasPrice = await suiClient.getReferenceGasPrice();
        // Basic transfer estimate: ~1000 gas units
        const estimatedGas = BigInt(gasPrice) * 1000n;
        setGasEstimate((Number(estimatedGas) / 1_000_000_000).toFixed(6));
      } catch {
        setGasEstimate(null);
      }
    };
    estimateGas();
  }, [form.recipient, form.amount, suiClient]);

  // Start Google OAuth flow
  const startGoogleOAuth = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID) {
      setZkError('Google Client ID not configured. Set VITE_GOOGLE_CLIENT_ID.');
      return;
    }

    try {
      // Generate ephemeral keypair
      const eph = Ed25519Keypair.generate();
      setEphemeralKeypair(eph);

      // Get current epoch
      const { epoch } = await suiClient.getLatestSuiSystemState();
      const maxEp = Number(epoch) + 2;
      setMaxEpoch(maxEp);

      // Generate nonce
      const rand = generateRandomness();
      setRandomness(rand.toString());
      const nonce = generateNonce(eph.getPublicKey(), maxEp, rand);
      setOauthNonce(nonce);

      // Store keypair info in sessionStorage for callback
      sessionStorage.setItem('zklogin_eph', JSON.stringify({
        secretKey: Array.from(eph.getSecretKey()),
        maxEpoch: maxEp,
        randomness: rand.toString()
      }));

      // Build OAuth URL
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'id_token',
        scope: 'openid',
        nonce: nonce
      });

      window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } catch (err) {
      setZkError(err instanceof Error ? err.message : 'OAuth setup failed');
    }
  }, [suiClient]);

  // Restore ephemeral key from session storage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem('zklogin_eph');
    if (stored && jwtToken) {
      try {
        const data = JSON.parse(stored);
        const eph = Ed25519Keypair.fromSecretKey(new Uint8Array(data.secretKey));
        setEphemeralKeypair(eph);
        setMaxEpoch(data.maxEpoch);
        setRandomness(data.randomness);
        // Clear after restore
        sessionStorage.removeItem('zklogin_eph');
      } catch {
        // Ignore parse errors
      }
    }
  }, [jwtToken]);

  // Clean URL - remove all sensitive params (transaction details now come from API)
  useEffect(() => {
    const url = new URL(window.location.href);
    const paramsToStrip = [
      'recipient',
      'amount',
      'memo',
      'jwt',
      'salt',
      'prover',
      'saltService',
      'tx',
      'sender',
      'mode'
    ];
    paramsToStrip.forEach((key) => url.searchParams.delete(key));
    if (url.search !== window.location.search) {
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('Building transaction...');
    setError(null);
    setDigest(null);

    if (!account?.address) {
      setError('Connect a wallet first.');
      return;
    }

    if (senderParam && account.address.toLowerCase() !== senderParam.toLowerCase()) {
      setError('Connected wallet does not match sender provided in the link.');
      setStatus(null);
      return;
    }

    const amountNum = Number(form.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Amount must be positive.');
      return;
    }

    // Warn for large amounts
    if (amountNum > 100) {
      const confirmed = window.confirm(`You are about to send ${amountNum} SUI. This is a large amount. Continue?`);
      if (!confirmed) {
        setStatus(null);
        return;
      }
    }

    try {
      const tx = new Transaction();
      const mist = BigInt(Math.round(amountNum * 1_000_000_000));
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(mist.toString())]);
      tx.transferObjects([coin], tx.pure.address(form.recipient));

      setStatus('Signing and executing...');
      const res = await signAndExecute({
        transaction: tx,
        options: { showEffects: true, showInput: true }
      });

      setDigest(res.digest);
      setStatus('Transaction submitted.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus(null);
    }
  };

  const onSubmitZk = async (e: React.FormEvent) => {
    e.preventDefault();
    setZkStatus('Preparing zkLogin transaction...');
    setZkError(null);
    setZkDigest(null);

    const amountNum = Number(form.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setZkError('Amount must be positive.');
      return;
    }
    if (!jwtToken) {
      setZkError('Provide a JWT (from OAuth) or click "Login with Google".');
      return;
    }

    // Warn for large amounts
    if (amountNum > 100) {
      const confirmed = window.confirm(`You are about to send ${amountNum} SUI. This is a large amount. Continue?`);
      if (!confirmed) {
        setZkStatus(null);
        return;
      }
    }

    try {
      const { sub, aud } = decodeJwt(jwtToken);
      if (!sub || !aud) {
        throw new Error('JWT missing sub or aud');
      }

      // 1) Fetch salt if not provided
      let saltValue = salt;
      if (!saltValue) {
        setZkStatus('Fetching salt...');
        saltValue = await fetchSalt(jwtToken, saltServiceUrl);
        setSalt(saltValue);
      }

      // 2) Derive zkLogin address
      const zkAddr = jwtToAddress(jwtToken, saltValue);
      setZkAddress(zkAddr);
      if (senderParam && zkAddr.toLowerCase() !== senderParam.toLowerCase()) {
        setZkError('Derived zkLogin address does not match sender provided in the link.');
        setZkStatus(null);
        return;
      }

      // 3) Use stored ephemeral key from OAuth flow, or generate new one
      let eph = ephemeralKeypair;
      let maxEp = maxEpoch;
      let rand = randomness;

      if (!eph || !maxEp || !rand) {
        setZkStatus('Generating ephemeral key...');
        eph = Ed25519Keypair.generate();
        const { epoch } = await suiClient.getLatestSuiSystemState();
        maxEp = Number(epoch) + 2;
        rand = generateRandomness().toString();
      }

      const nonce = generateNonce(eph.getPublicKey(), maxEp, BigInt(rand));

      // 4) Build unsigned transaction (sender = zkLogin address)
      const tx = new Transaction();
      tx.setSender(zkAddr);
      const mist = BigInt(Math.round(amountNum * 1_000_000_000));
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(mist.toString())]);
      tx.transferObjects([coin], tx.pure.address(form.recipient));

      // 5) User signature with ephemeral key
      setZkStatus('Signing with ephemeral key...');
      const { bytes, signature: userSignature } = await tx.sign({
        signer: eph,
        client: suiClient
      });

      // 6) Request proof from prover
      setZkStatus('Requesting zk proof (this may take 10-30s)...');
      const proof = await requestProof({
        proverUrl,
        jwt: jwtToken,
        salt: saltValue,
        maxEpoch: maxEp,
        jwtRandomness: rand,
        extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(eph.getPublicKey()).toString(),
        keyClaimName: 'sub',
        nonce
      });

      // 7) Assemble zkLogin signature
      const addressSeed = genAddressSeed(BigInt(saltValue), 'sub', sub, aud).toString();
      const zkLoginSignature = getZkLoginSignature({
        inputs: { ...proof, addressSeed },
        maxEpoch: maxEp,
        userSignature
      });

      // 8) Execute transaction
      setZkStatus('Broadcasting transaction...');
      const res = await suiClient.executeTransactionBlock({
        transactionBlock: bytes,
        signature: zkLoginSignature,
        options: { showEffects: true }
      });

      setZkDigest(res.digest);
      setZkStatus('Transaction submitted successfully!');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setZkError(message);
      setZkStatus(null);
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <div className="eyebrow">AI Copilot Wallet</div>
          <h1>Send SUI with Slush or any Sui wallet</h1>
          <p className="muted">
            Connect your wallet, build a transfer, and sign. zkLogin flow is available for users who
            provide an OAuth JWT.
          </p>
        </div>
        <ConnectButton />
      </header>

      <main className="grid">
        {/* Loading state for pending transaction */}
        {pendingTxLoading && (
          <div className="pending-tx-banner loading">
            Loading transaction details...
          </div>
        )}

        {/* Error state for pending transaction */}
        {pendingTxError && (
          <div className="pending-tx-banner error">
            {pendingTxError}
          </div>
        )}

        {/* Expiry warning */}
        {pendingTxExpiry && !pendingTxError && (
          <div className="pending-tx-banner info">
            Transaction from Telegram bot. Expires {new Date(pendingTxExpiry).toLocaleTimeString()}.
          </div>
        )}

        <section className="card">
          <div className="card-head">
            <div className="eyebrow">Transfer</div>
            <h2>Send funds</h2>
          </div>

          <div className="tabs">
            <button
              className={mode === 'wallet' ? 'tab active' : 'tab'}
              onClick={() => setMode('wallet')}
            >
              Wallet
            </button>
            <button
              className={mode === 'zklogin' ? 'tab active' : 'tab'}
              onClick={() => setMode('zklogin')}
            >
              zkLogin
            </button>
          </div>

          {senderParam && (
            <div className="info">
              <div><strong>Sender (from link):</strong> <code>{senderParam}</code></div>
              {account?.address && account.address.toLowerCase() !== senderParam.toLowerCase() && (
                <div className="status error">Connected wallet differs from the sender specified in this link.</div>
              )}
              {account?.address && account.address.toLowerCase() === senderParam.toLowerCase() && (
                <div className="status ok">Connected wallet matches the sender in this link.</div>
              )}
            </div>
          )}

          {mode === 'wallet' ? (
            <form className="form" onSubmit={onSubmit}>
              <label>
                <span>Recipient</span>
                <input
                  required
                  value={form.recipient}
                  onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value.trim() }))}
                  placeholder="0x..."
                />
              </label>
              <label>
                <span>Amount (SUI)</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.000001"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.1"
                />
                {Number(form.amount) > 100 && (
                  <span className="warning">⚠️ Large amount - confirm before sending</span>
                )}
              </label>
              <label>
                <span>Memo (optional)</span>
                <input
                  value={form.memo}
                  onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                  placeholder="Dinner split"
                />
              </label>

              {gasEstimate && (
                <div className="gas-estimate">
                  Estimated gas: ~{gasEstimate} SUI
                </div>
              )}

              <div className="actions">
                <button type="submit" disabled={isPending || !account}>
                  {isPending ? 'Sending…' : 'Send SUI'}
                </button>
                {status && <div className="status ok">{status}</div>}
                {error && <div className="status error">{error}</div>}
                {digest && (
                  <div className="status ok">
                    Digest:{' '}
                    <a href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${digest}`} target="_blank" rel="noopener noreferrer">
                      {digest.slice(0, 16)}...
                    </a>
                  </div>
                )}
              </div>
            </form>
          ) : (
            <form className="form" onSubmit={onSubmitZk}>
              {/* Google OAuth button */}
              {!jwtToken && GOOGLE_CLIENT_ID && (
                <div className="oauth-section">
                  <button type="button" className="google-btn" onClick={startGoogleOAuth}>
                    🔐 Login with Google
                  </button>
                  <p className="muted">Or paste a JWT manually below</p>
                </div>
              )}

              {zkAddress && (
                <div className="info zkaddress">
                  <strong>zkLogin Address:</strong>
                  <code>{zkAddress.slice(0, 10)}...{zkAddress.slice(-8)}</code>
                </div>
              )}

              <label>
                <span>Recipient</span>
                <input
                  required
                  value={form.recipient}
                  onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value.trim() }))}
                  placeholder="0x..."
                />
              </label>
              <label>
                <span>Amount (SUI)</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.000001"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.1"
                />
                {Number(form.amount) > 100 && (
                  <span className="warning">⚠️ Large amount - confirm before sending</span>
                )}
              </label>
              <label>
                <span>JWT (from OAuth provider)</span>
                <textarea
                  value={jwtToken}
                  onChange={(e) => setJwtToken(e.target.value.trim())}
                  placeholder="Paste the OAuth JWT here or use Google login above"
                  rows={3}
                />
              </label>

              <details className="advanced-options">
                <summary>Advanced Options</summary>
                <label>
                  <span>Salt (optional)</span>
                  <input
                    value={salt}
                    onChange={(e) => setSalt(e.target.value.trim())}
                    placeholder="Leave blank to fetch from salt service"
                  />
                </label>
                <div className="config-info">
                  <small>Using {SUI_NETWORK} network</small>
                </div>
              </details>

              {gasEstimate && (
                <div className="gas-estimate">
                  Estimated gas: ~{gasEstimate} SUI
                </div>
              )}

              <div className="actions">
                <button type="submit" disabled={!jwtToken}>
                  {zkStatus ? 'Processing...' : 'Sign & Send with zkLogin'}
                </button>
                {zkStatus && <div className="status ok">{zkStatus}</div>}
                {zkError && <div className="status error">{zkError}</div>}
                {zkDigest && (
                  <div className="status ok">
                    ✅ Digest:{' '}
                    <a href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${zkDigest}`} target="_blank" rel="noopener noreferrer">
                      {zkDigest.slice(0, 16)}...
                    </a>
                  </div>
                )}
              </div>
            </form>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div className="eyebrow">Wallet</div>
            <h2>Current account</h2>
          </div>
          {account ? (
            <div className="info">
              <div>Address: {account.address}</div>
              <div>Wallet: {account.label}</div>
            </div>
          ) : (
            <div className="muted">Connect a wallet to start.</div>
          )}
        </section>
      </main>
    </div>
  );
}

function decodeJwt(token: string): { sub?: string; aud?: string } {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  const payload = parts[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function fetchSalt(jwt: string, url: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jwt })
  });
  if (!res.ok) {
    throw new Error(`Salt service error ${res.status}`);
  }
  const data = await res.json();
  const salt = data?.salt;
  if (!salt) throw new Error('Salt not returned');
  return String(salt);
}

async function requestProof(params: {
  proverUrl: string;
  jwt: string;
  salt: string;
  maxEpoch: number;
  jwtRandomness: string;
  extendedEphemeralPublicKey: string;
  keyClaimName: string;
  nonce: string;
}) {
  const res = await fetch(params.proverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jwt: params.jwt,
      salt: params.salt,
      maxEpoch: params.maxEpoch.toString(),
      jwtRandomness: params.jwtRandomness,
      extendedEphemeralPublicKey: params.extendedEphemeralPublicKey,
      keyClaimName: params.keyClaimName,
      nonce: params.nonce
    })
  });
  if (!res.ok) {
    throw new Error(`Prover error ${res.status}`);
  }
  return res.json();
}
