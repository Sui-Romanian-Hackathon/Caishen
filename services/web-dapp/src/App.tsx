import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider,
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient
} from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import {
  generateNonce,
  generateRandomness,
  genAddressSeed,
  getExtendedEphemeralPublicKey,
  getZkLoginSignature,
  jwtToAddress,
  decodeJwt as sdkDecodeJwt
} from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { EnokiClient } from '@mysten/enoki';  // Using Enoki
import { useEffect, useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { LinkPage } from './LinkPage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Check } from 'lucide-react';
import { AddressDisplay } from '@/components/AddressDisplay';

// Configuration from environment variables (build-time)
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
// Prover URL for zkLogin (use prover.mystenlabs.com for testnet/mainnet, prover-dev for devnet)
// const PROVER_URL = 'https://prover.mystenlabs.com/v1'; 
const ENOKI_API_KEY = import.meta.env.VITE_ENOKI_API_KEY || ''; // Using Enoki
const SUI_NETWORK = import.meta.env.VITE_SUI_NETWORK || 'testnet';

// Initialize Enoki client for zkLogin proofs // Using Enoki 
const enokiClient = new EnokiClient({ apiKey: ENOKI_API_KEY }); // Using Enoki
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://caishen.iseethereaper.com';
const REDIRECT_URI = typeof window !== 'undefined' ? `${window.location.origin}/callback` : '';
const SALT_SERVICE_URL =
  import.meta.env.VITE_ZKLOGIN_SALT_SERVICE_URL || `${API_BASE_URL}/api/v1/zklogin/salt`;
const ZKLOGIN_STORAGE_KEY = 'zklogin_eph';

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl('testnet') },
  mainnet: { url: getFullnodeUrl('mainnet') }
});

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={SUI_NETWORK as 'testnet' | 'mainnet'}>
        <WalletProvider autoConnect>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<WalletGatePage />} />
              <Route path="/send-funds" element={<SendFundsPage />} />
              <Route path="/create-wallet" element={<CreateWalletPage />} />
              <Route path="/link" element={<LinkPage />} />
              <Route path="/link/*" element={<LinkPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}

// Landing page - "Do you have a crypto wallet?"
function WalletGatePage() {
  const navigate = useNavigate();

  const handleConnectWallet = () => {
    navigate("/link");
  };

  const handleCreateWallet = () => {
    navigate("/create-wallet");
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-10 max-w-2xl w-full text-center">
        <div>
          <p className="text-xs text-primary uppercase tracking-wider mb-4">Caishen</p>
          <h1 className="text-3xl md:text-5xl font-bold text-foreground leading-tight">
            Do you already have a crypto wallet?
          </h1>
        </div>

        <div className="flex flex-col gap-6 w-full max-w-md">
          <button
            onClick={handleConnectWallet}
            aria-label="Connect existing wallet and proceed to send funds page."
            className="w-full min-h-[80px] px-8 py-6 text-xl font-bold rounded-xl transition-all
                       bg-primary text-primary-foreground hover:bg-primary/90
                       focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          >
            Yes, I have a wallet
          </button>

          <button
            onClick={handleCreateWallet}
            aria-label="Create a new wallet."
            className="w-full min-h-[80px] px-8 py-6 text-xl font-bold rounded-xl transition-all
                       bg-secondary text-secondary-foreground hover:bg-secondary/80
                       focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          >
            No, I need a new wallet
          </button>
        </div>
      </div>
    </main>
  );
}

// Create wallet page
function CreateWalletPage() {
  const navigate = useNavigate();
  const suiClient = useSuiClient();
  const [step, setStep] = useState<'ready' | 'processing' | 'complete' | 'error'>('ready');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zkAddress, setZkAddress] = useState<string | null>(null);
  const [zkSalt, setZkSalt] = useState<string | null>(null);
  const [zkSub, setZkSub] = useState<string | null>(null);
  const [maxEpoch, setMaxEpoch] = useState<number | null>(null);
  const storageKey = 'create_wallet_state';

  // Parse OAuth callback (Google id_token in URL hash)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('id_token=')) {
      const match = hash.match(/id_token=([^&]+)/);
      if (match) {
        const jwt = decodeURIComponent(match[1]);
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
        void handleZkLoginCallback(jwt);
      }
    } else if (hash.includes('error=')) {
      const errorMatch = hash.match(/error=([^&]+)/);
      const descMatch = hash.match(/error_description=([^&]+)/);
      const description = descMatch?.[1] ? decodeURIComponent(descMatch[1]) : '';
      setError(`OAuth error: ${decodeURIComponent(errorMatch?.[1] || 'unknown')}${description ? ` - ${description}` : ''}`);
      setStep('error');
      window.history.replaceState({}, '', window.location.pathname + window.location.search);
    }
  }, []);

  const startZkLogin = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Google Client ID not configured.');
      setStep('error');
      return;
    }

    try {
      setError(null);
      setStatus('Preparing Google sign-in...');
      setStep('processing');

      // Ephemeral key for zkLogin session
      const eph = Ed25519Keypair.generate();

      // maxEpoch guard (gives us a bounded session)
      const { epoch } = await suiClient.getLatestSuiSystemState();
      const maxEp = Number(epoch) + 10;
      setMaxEpoch(maxEp);

      // Generate nonce and persist session data across redirect
      const randomness = generateRandomness();
      const nonce = generateNonce(eph.getPublicKey(), maxEp, randomness);

      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          secretKey: Array.from(eph.getSecretKey()),
          maxEpoch: maxEp,
          randomness: randomness.toString()
        })
      );

      const redirectUri = `${window.location.origin}/create-wallet`;
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'id_token',
        scope: 'openid',
        nonce
      });

      setStatus('Redirecting to Google...');
      window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start zkLogin');
      setStep('error');
      setStatus(null);
    }
  }, [suiClient]);

  const handleZkLoginCallback = useCallback(
    async (jwt: string) => {
      try {
        setStep('processing');
        setStatus('Processing Google authentication...');
        setError(null);
        setZkAddress(null);

        const stored = sessionStorage.getItem(storageKey);
        if (!stored) {
          throw new Error('Session data missing. Please restart the flow.');
        }
        sessionStorage.removeItem(storageKey);
        try {
          const parsed = JSON.parse(stored) as { maxEpoch?: number };
          if (parsed?.maxEpoch !== undefined) {
            setMaxEpoch(parsed.maxEpoch);
          }
        } catch {
          // Ignore parse errors; flow can continue without maxEpoch display
        }

        const { sub } = decodeJwt(jwt);
        if (!sub) {
          throw new Error('Invalid JWT: subject missing.');
        }
        setZkSub(sub);

        const saltRes = await fetchSaltFromService(jwt);
        if (!saltRes?.salt) {
          throw new Error('Salt service did not return a salt.');
        }

        setZkSalt(String(saltRes.salt));

        // Derive deterministic Sui address using backend salt
        const address =
          saltRes.derivedAddress && typeof saltRes.derivedAddress === 'string'
            ? saltRes.derivedAddress
            : jwtToAddress(jwt, BigInt(saltRes.salt));
        setZkAddress(address);

        setStatus('Wallet created! You can now save or fund this address.');
        setStep('complete');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'zkLogin failed');
        setStep('error');
        setStatus(null);
      }
    },
    []
  );

  const resetFlow = () => {
    setError(null);
    setStatus(null);
    setZkAddress(null);
    setZkSalt(null);
    setZkSub(null);
    setMaxEpoch(null);
    sessionStorage.removeItem(storageKey);
    setStep('ready');
  };

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-8 max-w-3xl w-full text-center">
        <div>
          <p className="text-xs text-primary uppercase tracking-wider mb-4">Caishen</p>
          <h1 className="text-3xl md:text-5xl font-bold text-foreground leading-tight">
            Create Your zkLogin Wallet
          </h1>
          <p className="text-muted-foreground mt-3 max-w-2xl mx-auto text-base">
            No seed phrase. Sign in with Google, fetch a deterministic salt, and derive your Sui zkLogin address.
          </p>
        </div>

        <div className="w-full max-w-2xl space-y-6">
          {step === 'ready' && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-xl">Step 1: Authenticate with Google</CardTitle>
                <CardDescription>We’ll create an ephemeral keypair and redirect you to Google to get an id_token.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  onClick={startZkLogin}
                  className="w-full gradient-button text-primary-foreground font-semibold"
                >
                  Continue with Google
                </Button>
                <p className="text-xs text-muted-foreground">
                  Deterministic: the same Google account + salt will always produce the same Sui address.
                </p>
              </CardContent>
            </Card>
          )}

          {step === 'processing' && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-xl">Working on it…</CardTitle>
                <CardDescription>Completing zkLogin steps</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-left">
                {(() => {
                  const googleState: StatusState = !status
                    ? 'active'
                    : status.toLowerCase().includes('google')
                      ? 'active'
                      : 'done';
                  const saltState: StatusState = status?.toLowerCase().includes('salt')
                    ? 'active'
                    : zkSalt
                      ? 'done'
                      : 'idle';
                  const addressState: StatusState = zkAddress ? 'done' : 'idle';
                  return (
                    <div className="space-y-2">
                      <StatusRow label="Google sign-in" state={googleState} />
                      <StatusRow label="Fetch salt" state={saltState} />
                      <StatusRow label="Derive Sui address" state={addressState} />
                    </div>
                  );
                })()}
                {status && <p className="text-sm text-primary">{status}</p>}
                {error && <p className="text-sm text-destructive">{error}</p>}
              </CardContent>
            </Card>
          )}

          {step === 'complete' && zkAddress && (
            <Card className="bg-primary/5 border-primary/30">
              <CardHeader>
                <CardTitle className="text-xl">Wallet Created</CardTitle>
                <CardDescription>Save these details to re-derive or sign later.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-left">
                <InfoRow label="Sui Address" value={<AddressDisplay address={zkAddress} />} copyText={zkAddress} />
                {zkSalt && <InfoRow label="Salt" value={zkSalt} copyText={zkSalt} />}
                {zkSub && <InfoRow label="Google sub" value={zkSub} />}
                {typeof maxEpoch === 'number' && (
                  <InfoRow label="maxEpoch (session)" value={String(maxEpoch)} />
                )}
                <div className="flex flex-col gap-3 pt-2">
                  <Button
                    onClick={() => navigate('/')}
                    className="w-full gradient-button text-primary-foreground font-semibold"
                  >
                    Back to start
                  </Button>
                  <Button variant="secondary" onClick={() => navigate('/link')}>
                    Link this wallet to Telegram
                  </Button>
                  <Button variant="outline" onClick={resetFlow}>
                    Create another wallet
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {step === 'error' && (
            <Card className="bg-destructive/5 border-destructive/30">
              <CardHeader>
                <CardTitle className="text-xl">Something went wrong</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {error && <p className="text-destructive text-sm">{error}</p>}
                <div className="flex flex-col gap-3">
                  <Button onClick={resetFlow} variant="secondary">
                    Try again
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/')}>
                    ← Back to wallet selection
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}

// 404 page
function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">
        <p className="text-xs text-primary uppercase tracking-wider">Caishen</p>
        <h1 className="text-4xl font-bold text-foreground">404</h1>
        <p className="text-muted-foreground">Page not found</p>
        <button
          onClick={() => navigate("/")}
          className="px-6 py-3 font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Go Home
        </button>
      </div>
    </main>
  );
}

type StatusState = 'idle' | 'active' | 'done';

function StatusRow({ label, state }: { label: string; state: StatusState }) {
  const color =
    state === 'done' ? 'bg-green-500' : state === 'active' ? 'bg-primary' : 'bg-border';
  return (
    <div className="flex items-center gap-3">
      <span className={`w-3 h-3 rounded-full ${color}`} />
      <span className="text-sm text-foreground">{label}</span>
      {state === 'done' && <Check size={16} className="text-green-500" />}
    </div>
  );
}

function InfoRow({
  label,
  value,
  copyText
}: {
  label: string;
  value: React.ReactNode;
  copyText?: string;
}) {
  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      // no-op
    }
  };

  return (
    <div className="p-3 rounded-lg border border-border bg-background flex flex-col gap-2">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm break-all font-mono">{value}</div>
      {copyText && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={handleCopy}>
            Copy
          </Button>
        </div>
      )}
    </div>
  );
}

// Send funds page
function SendFundsPage() {
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
  const [pendingTelegramId, setPendingTelegramId] = useState<string | null>(null);

  // Form state - check sessionStorage first (for OAuth callback), then URL params
  const [form, setForm] = useState(() => {
    // First check if we have stored tx params from OAuth flow
    const stored = sessionStorage.getItem(ZKLOGIN_STORAGE_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.txParams) {
          return {
            recipient: data.txParams.recipient || '',
            amount: data.txParams.amount || '',
            memo: data.txParams.memo || ''
          };
        }
      } catch {
        // Ignore parse errors
      }
    }
    
    // Fall back to URL params
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
  const [senderParam, setSenderParam] = useState(() => {
    // First check sessionStorage (for OAuth callback)
    const stored = sessionStorage.getItem(ZKLOGIN_STORAGE_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.txParams?.sender) {
          return data.txParams.sender;
        }
      } catch {
        // Ignore
      }
    }
    // Fall back to URL
    const url = new URL(window.location.href);
    return url.searchParams.get('sender') || '';
  });
  
  // Auto-detect mode: if sender is provided, default to zklogin (user likely has zkLogin wallet)
  const [mode, setMode] = useState<'wallet' | 'zklogin'>(() => {
    // Check sessionStorage first (for OAuth callback)
    const stored = sessionStorage.getItem(ZKLOGIN_STORAGE_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.txParams?.sender) {
          return 'zklogin'; // Coming back from OAuth with sender = zklogin flow
        }
      } catch {
        // Ignore
      }
    }
    
    const url = new URL(window.location.href);
    const explicitMode = url.searchParams.get('mode');
    if (explicitMode === 'zklogin') return 'zklogin';
    if (explicitMode === 'wallet') return 'wallet';
    // If sender is provided (from Telegram), default to zklogin
    const sender = url.searchParams.get('sender');
    return sender ? 'zklogin' : 'wallet';
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
  const [zkStatus, setZkStatus] = useState<string | null>(null);
  const [zkError, setZkError] = useState<string | null>(null);
  const [zkDigest, setZkDigest] = useState<string | null>(null);

  // Gas estimation state
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);
  const [zkAddress, setZkAddress] = useState<string | null>(null);

  // Ephemeral key stored for OAuth callback flow
  const [ephemeralKeypair, setEphemeralKeypair] = useState<Ed25519Keypair | null>(null);
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
        if (data.sender) setSenderParam(data.sender);
        if (data.expiresAt) setPendingTxExpiry(data.expiresAt);
        if (data.telegramId) setPendingTelegramId(String(data.telegramId));

        console.log('[pendingTx] Loaded from API:', {
          recipient: data.recipient,
          amount: data.amount,
          sender: data.sender,
          salt: data.salt,
          mode: data.mode
        });

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

  // Derive zkLogin address when JWT or salt changes
  useEffect(() => {
    if (jwtToken && salt) {
      try {
        const { saltBigInt } = normalizeSalt(salt);
        const addr = jwtToAddress(jwtToken, saltBigInt);
        setZkAddress(addr);
        console.log('[zkLogin] Derived address with salt:', { salt, address: addr });
      } catch (err) {
        console.error('[zkLogin] Failed to derive address:', err);
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

      // Store keypair server-side (more reliable than sessionStorage across OAuth redirects)
      const secretKeyBech32 = eph.getSecretKey(); // Returns Bech32 string like "suiprivkey1..."
      const sessionId = crypto.randomUUID();

      // Decode Bech32 to get raw 32-byte seed
      const { secretKey: rawSecretKey } = decodeSuiPrivateKey(secretKeyBech32);
      const secretKeyArray = Array.from(rawSecretKey);
      console.log('[zkLogin] secretKey decoded, length:', secretKeyArray.length);
      console.log('[zkLogin] STORE - ephemeral pubkey:', eph.getPublicKey().toBase64());

      // Store on server
      const storeRes = await fetch(`${API_BASE_URL}/api/ephemeral`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          secretKey: secretKeyArray,
          maxEpoch: maxEp,
          randomness: rand.toString(),
          txParams: {
            recipient: form.recipient,
            amount: form.amount,
            sender: senderParam,
            memo: form.memo
          }
        })
      });

      if (!storeRes.ok) {
        throw new Error('Failed to store ephemeral key on server');
      }

      // Store only the session ID in sessionStorage (small, reliable)
      sessionStorage.setItem(ZKLOGIN_STORAGE_KEY, JSON.stringify({ sessionId }));

      // Build OAuth URL - redirect back to /send-funds (whitelisted in Google Console)
      const redirectUri = `${window.location.origin}/send-funds`;
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'id_token',
        scope: 'openid',
        nonce: nonce
      });

      window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } catch (err) {
      setZkError(err instanceof Error ? err.message : 'OAuth setup failed');
    }
  }, [suiClient]);

  // Restore ephemeral key from server using session ID
  useEffect(() => {
    const stored = sessionStorage.getItem(ZKLOGIN_STORAGE_KEY);
    console.log('[zkLogin] Checking sessionStorage for session ID', {
      hasJwt: !!jwtToken,
      hasStored: !!stored
    });

    if (!stored) {
      return;
    }

    const restoreFromServer = async () => {
      try {
        const data = JSON.parse(stored);
        console.log('[zkLogin] Found session data:', { hasSessionId: !!data.sessionId });

        if (data.sessionId) {
          // Fetch from server (one-time use, will be deleted)
          const res = await fetch(`${API_BASE_URL}/api/ephemeral/${data.sessionId}`);
          if (!res.ok) {
            console.error('[zkLogin] Failed to fetch ephemeral key from server:', res.status);
            sessionStorage.removeItem(ZKLOGIN_STORAGE_KEY);
            return;
          }

          const serverData = await res.json();
          console.log('[zkLogin] Retrieved from server:', {
            hasSecretKey: !!serverData.secretKey,
            maxEpoch: serverData.maxEpoch,
            hasRandomness: !!serverData.randomness
          });

          // Restore ephemeral keypair
          if (serverData.secretKey) {
            const seed = new Uint8Array(serverData.secretKey);
            console.log('[zkLogin] Secret key length:', seed.length);

            if (seed.length !== 32) {
              console.error('[zkLogin] Invalid seed length:', seed.length);
              sessionStorage.removeItem(ZKLOGIN_STORAGE_KEY);
              return;
            }

            const eph = Ed25519Keypair.fromSecretKey(seed);
            setEphemeralKeypair(eph);
            console.log('[zkLogin] RESTORE - ephemeral pubkey:', eph.getPublicKey().toBase64());
            console.log('[zkLogin] Ephemeral keypair restored from server');
          }

          if (serverData.maxEpoch !== undefined) setMaxEpoch(serverData.maxEpoch);
          if (serverData.randomness) setRandomness(serverData.randomness);

          if (serverData.txParams) {
            setForm({
              recipient: serverData.txParams.recipient || '',
              amount: serverData.txParams.amount || '',
              memo: serverData.txParams.memo || ''
            });
          }

          // Clear session storage after successful restore
          sessionStorage.removeItem(ZKLOGIN_STORAGE_KEY);
          console.log('[zkLogin] Ephemeral key restored and session cleared');
        }
      } catch (err) {
        console.error('[zkLogin] Error restoring from server:', err);
        sessionStorage.removeItem(ZKLOGIN_STORAGE_KEY);
      }
    };

    restoreFromServer();
  }, []);

  // Fetch salt from backend once we have a JWT (no hardcoded fallback)
  useEffect(() => {
    if (!jwtToken || salt) return;

    const targetTelegramId = pendingTelegramId || undefined;
    setZkStatus((prev) => prev ?? 'Fetching zkLogin salt from backend...');

    fetchSaltFromService(jwtToken, targetTelegramId)
      .then((resp) => {
        if (resp?.salt) {
          setSalt(String(resp.salt));
        }
        if (resp?.derivedAddress) {
          setZkAddress(resp.derivedAddress);
        }
        setZkStatus((prev) => (prev === 'Fetching zkLogin salt from backend...' ? null : prev));
      })
      .catch((err) => {
        console.error('[zkLogin] Failed to fetch salt', err);
        setZkError(err instanceof Error ? err.message : 'Failed to fetch salt from backend');
        setZkStatus(null);
      });
  }, [jwtToken, pendingTelegramId, salt]);

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
      // Use SDK's decodeJwt for consistent handling (normalizes issuer, validates aud)
      const decoded = sdkDecodeJwt(jwtToken);
      const { sub, aud, iss } = decoded;
      console.log('[zkLogin] ===== DECODED JWT =====');
      console.log('[zkLogin] sub:', sub);
      console.log('[zkLogin] aud:', aud);  
      console.log('[zkLogin] iss:', iss);

      if (!salt) {
        setZkError('Salt not loaded from backend. Please sign in again to refresh the session.');
        setZkStatus(null);
        return;
      }

      const { saltBigInt, saltString: saltValue } = normalizeSalt(salt);
      console.log('[zkLogin] ===== SALT =====');
      console.log('[zkLogin] rawSaltValue:', salt);
      console.log('[zkLogin] saltValue (normalized):', saltValue);
      console.log('[zkLogin] saltBigInt:', saltBigInt.toString());
      console.log('[zkLogin] Using salt from backend service');

      // 2) Derive zkLogin address
      const zkAddr = jwtToAddress(jwtToken, saltBigInt);
      
      // Compute addressSeed for verification
      const expectedAddressSeed = genAddressSeed(saltBigInt, 'sub', sub, aud).toString();
      console.log('[zkLogin] ===== ADDRESS COMPUTATION =====');
      console.log('[zkLogin] expectedAddressSeed:', expectedAddressSeed);
      console.log('[zkLogin] zkAddr:', zkAddr);
      setZkAddress(zkAddr);
      if (senderParam && zkAddr.toLowerCase() !== senderParam.toLowerCase()) {
        setZkError('Derived zkLogin address does not match sender provided in the link.');
        setZkStatus(null);
        return;
      }

      // 3) Use stored ephemeral key from OAuth flow
      // These MUST be the same keys used when getting the JWT, otherwise nonce won't match
      let eph = ephemeralKeypair;
      let maxEp = maxEpoch;
      let rand = randomness;

      if (!eph || !maxEp || !rand) {
        // If JWT came from OAuth but we don't have stored keys, we can't proceed
        // The nonce in the JWT was computed with specific ephemeral key params
        setZkError('Ephemeral key not found. Please sign in with Google again to get a fresh token.');
        setZkStatus(null);
        return;
      }

      // Verify epoch hasn't expired
      const { epoch: currentEpoch } = await suiClient.getLatestSuiSystemState();
      console.log('[zkLogin] Current epoch:', currentEpoch, 'maxEpoch:', maxEp);
      if (Number(currentEpoch) > maxEp) {
        setZkError(`Session expired (current epoch ${currentEpoch} > maxEpoch ${maxEp}). Please sign in with Google again.`);
        setZkStatus(null);
        return;
      }
      
      // Log full public key for debugging
      const ephPubKeyBase64 = eph.getPublicKey().toBase64();
      console.log('[zkLogin] Using ephemeral key:', {
        publicKeyBase64: ephPubKeyBase64,
        publicKeySuiAddr: eph.getPublicKey().toSuiAddress(),
        maxEpoch: maxEp,
        randomness: rand.slice(0, 20) + '...'
      });

      const nonce = generateNonce(eph.getPublicKey(), maxEp, BigInt(rand));

      // Verify nonce matches JWT
      const jwtParts = jwtToken.split('.');
      const jwtPayload = JSON.parse(atob(jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')));
      console.log('[zkLogin] Nonce verification:', {
        computedNonce: nonce,
        jwtNonce: jwtPayload.nonce,
        match: nonce === jwtPayload.nonce
      });

      if (nonce !== jwtPayload.nonce) {
        console.error('[zkLogin] CRITICAL: Nonce mismatch! Ephemeral key was not restored correctly.');
        setZkError('Nonce mismatch - ephemeral key restore failed. Please sign in again.');
        setZkStatus(null);
        return;
      }

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

      // 6) Request proof from Mysten prover
      // setZkStatus('Requesting zk proof (this may take 10-30s)...');
      // console.log('[zkLogin] ===== PROVER REQUEST =====');

      // 6) Request proof from Enoki
      setZkStatus('Requesting zk proof via Enoki (this may take 10-30s)...'); // Using Enoki
      console.log('[zkLogin] ===== ENOKI PROVER REQUEST =====');  // Using Enoki

      // const proverUrl = PROVER_URL; // Production prover for testnet/mainnet

      const extendedEphPubKey = getExtendedEphemeralPublicKey(eph.getPublicKey());
      console.log('[zkLogin] extendedEphemeralPublicKey:', extendedEphPubKey);  // Using Enoki

      //  const proofResponse = await fetch(proverUrl, {
      //  method: 'POST',
      //  headers: { 'Content-Type': 'application/json' },
      //  body: JSON.stringify({

      const proof = await enokiClient.createZkLoginZkp({  // Using Enoki
        jwt: jwtToken,
      // extendedEphemeralPublicKey: extendedEphPubKey,
        ephemeralPublicKey: eph.getPublicKey(), // Using Enoki
        maxEpoch: maxEp,
      //  jwtRandomness: rand,
      //  salt: saltValue,
      //  keyClaimName: 'sub'
      //})
        randomness: rand,// Using Enoki
        salt: saltValue // Using Enoki
      });

      //  if (!proofResponse.ok) {
      //const errorText = await proofResponse.text();
      //throw new Error(`Prover error ${proofResponse.status}: ${errorText}`);
      //}
      
      //const proof = await proofResponse.json();
      //console.log('[zkLogin] ===== PROVER RESPONSE =====');

      console.log('[zkLogin] ===== ENOKI PROVER RESPONSE =====');   // Using Enoki
      console.log('[zkLogin] Full proof:', JSON.stringify(proof, null, 2));
      
      // Build zkLogin inputs - use addressSeed from prover if available
      const addressSeed = proof.addressSeed || genAddressSeed(saltBigInt, 'sub', sub, aud).toString();
      console.log('[zkLogin] addressSeed (from prover or computed):', addressSeed);
      console.log('[zkLogin] Our computed addressSeed:', expectedAddressSeed);
      console.log('[zkLogin] Match:', addressSeed === expectedAddressSeed);
      
      const zkLoginInputs = {
        proofPoints: proof.proofPoints,
        issBase64Details: proof.issBase64Details,
        headerBase64: proof.headerBase64,
        addressSeed: addressSeed
      };
      
      console.log('[zkLogin] ===== BUILDING SIGNATURE =====');
      console.log('[zkLogin] maxEpoch for signature:', maxEp);
      console.log('[zkLogin] userSignature:', userSignature);
      console.log('[zkLogin] userSignature length:', userSignature?.length);
      console.log('[zkLogin] Transaction bytes:', bytes);
      
      const zkLoginSignature = getZkLoginSignature({
        inputs: zkLoginInputs,
        maxEpoch: maxEp,
        userSignature
      });
      
      console.log('[zkLogin] zkLoginSignature:', zkLoginSignature?.slice(0, 100) + '...');
      console.log('[zkLogin] zkLoginSignature length:', zkLoginSignature?.length);

      // 8) Execute transaction
      setZkStatus('Broadcasting transaction...');
      console.log('[zkLogin] ===== EXECUTING TRANSACTION =====');
      console.log('[zkLogin] sender (zkAddr):', zkAddr);
      console.log('[zkLogin] transaction bytes length:', bytes?.length);
      
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

  // Toggle button classes
  const toggleBaseClasses = 
    "px-4 py-2 rounded-lg text-sm transition-all border-2 border-toggle-border " +
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-toggle-border focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const toggleActiveClasses = "bg-toggle-active text-toggle-active-foreground font-bold";
  const toggleInactiveClasses = "bg-transparent text-toggle-inactive font-medium hover:bg-toggle-inactive/10";

  return (
    <div className="min-h-screen bg-background p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
          <div>
            <p className="text-xs text-primary uppercase tracking-wider mb-2">Caishen</p>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
              Send SUI with Slush or any Sui wallet
            </h1>
            <p className="text-muted-foreground text-sm max-w-xl">
              Connect your wallet, build a transfer, and sign. zkLogin flow is available for users who provide an OAuth JWT.
            </p>
          </div>
          <div className="sm:self-center">
            <ConnectButton />
          </div>
        </header>

        {/* Main Content */}
        <main className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Loading state for pending transaction */}
          {pendingTxLoading && (
            <div className="col-span-full bg-blue-500/15 border border-blue-500/30 text-blue-400 rounded-lg p-4 text-center text-sm">
              Loading transaction details...
            </div>
          )}

          {/* Error state for pending transaction */}
          {pendingTxError && (
            <div className="col-span-full bg-destructive/15 border border-destructive/30 text-destructive rounded-lg p-4 text-center text-sm">
              {pendingTxError}
            </div>
          )}

          {/* Expiry warning */}
          {pendingTxExpiry && !pendingTxError && (
            <div className="col-span-full bg-primary/10 border border-primary/30 text-primary rounded-lg p-4 text-center text-sm">
              Transaction from Telegram bot. Expires {new Date(pendingTxExpiry).toLocaleTimeString()}.
            </div>
          )}

          {/* Send Funds Card */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Transfer</p>
              </div>
              <CardTitle className="text-xl">Send funds</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Tab Switcher */}
              <div className="flex gap-2 mb-6" role="group" aria-label="Transfer method">
                <button
                  type="button"
                  aria-pressed={mode === 'wallet'}
                  onClick={() => setMode('wallet')}
                  className={`${toggleBaseClasses} ${
                    mode === 'wallet' ? toggleActiveClasses : toggleInactiveClasses
                  } flex items-center gap-1.5`}
                >
                  {mode === 'wallet' && (
                    <Check size={16} className="text-toggle-active-foreground" aria-hidden="true" />
                  )}
                  Wallet
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'zklogin'}
                  onClick={() => setMode('zklogin')}
                  className={`${toggleBaseClasses} ${
                    mode === 'zklogin' ? toggleActiveClasses : toggleInactiveClasses
                  } flex items-center gap-1.5`}
                >
                  {mode === 'zklogin' && (
                    <Check size={16} className="text-toggle-active-foreground" aria-hidden="true" />
                  )}
                  zkLogin
                </button>
              </div>

              {senderParam && (
                <div className="mb-4 p-3 bg-secondary/50 rounded-lg text-sm">
                  <div className="flex flex-col gap-1">
                    <strong>Sender (from link):</strong>
                    <AddressDisplay address={senderParam} size="sm" />
                  </div>
                  {account?.address && account.address.toLowerCase() !== senderParam.toLowerCase() && (
                    <div className="text-destructive mt-2">Connected wallet differs from the sender specified in this link.</div>
                  )}
                  {account?.address && account.address.toLowerCase() === senderParam.toLowerCase() && (
                    <div className="text-primary mt-2">Connected wallet matches the sender in this link.</div>
                  )}
                </div>
              )}

              {mode === 'wallet' ? (
                <form className="space-y-4" onSubmit={onSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="recipient">Recipient</Label>
                    <Input
                      id="recipient"
                      required
                      value={form.recipient}
                      onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value.trim() }))}
                      placeholder="0x..."
                      className="bg-input border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount (SUI)</Label>
                    <Input
                      id="amount"
                      required
                      type="number"
                      min="0"
                      step="0.000001"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                      placeholder="0.1"
                      className="bg-input border-border"
                    />
                    {Number(form.amount) > 100 && (
                      <span className="text-yellow-500 text-xs">⚠️ Large amount - confirm before sending</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="memo">Memo (optional)</Label>
                    <Input
                      id="memo"
                      value={form.memo}
                      onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                      placeholder="Dinner split"
                      className="bg-input border-border"
                    />
                  </div>

                  {gasEstimate && (
                    <div className="bg-muted/50 p-3 rounded-lg text-sm text-muted-foreground">
                      Estimated gas: ~{gasEstimate} SUI
                    </div>
                  )}

                  <div className="space-y-3 pt-2">
                    <Button 
                      type="submit" 
                      disabled={isPending || !account}
                      className="w-full gradient-button text-primary-foreground font-semibold py-6"
                    >
                      {isPending ? 'Sending…' : 'Send SUI'}
                    </Button>
                    {status && <div className="text-primary text-sm">{status}</div>}
                    {error && <div className="text-destructive text-sm">{error}</div>}
                    {digest && (
                      <div className="text-primary text-sm">
                        Digest:{' '}
                        <a 
                          href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${digest}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="underline hover:text-primary/80"
                        >
                          {digest.slice(0, 16)}...
                        </a>
                      </div>
                    )}
                  </div>
                </form>
              ) : (
                <form className="space-y-4" onSubmit={onSubmitZk}>
                  {/* Google OAuth button - prominent when coming from Telegram */}
                  {!jwtToken && GOOGLE_CLIENT_ID && (
                    <div className={`flex flex-col items-center gap-3 p-5 rounded-xl ${
                      senderParam 
                        ? 'bg-blue-500/10 border-2 border-blue-500/50' 
                        : 'border border-dashed border-border'
                    }`}>
                      {senderParam && (
                        <div className="text-center mb-2">
                          <p className="text-sm font-semibold text-blue-400">
                            🔐 Sign in to complete your transaction
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Use the same Google account you used to create your wallet
                          </p>
                        </div>
                      )}
                      <Button 
                        type="button" 
                        onClick={startGoogleOAuth}
                        className={`${
                          senderParam 
                            ? 'bg-blue-500 hover:bg-blue-600 text-white text-lg py-6 px-8' 
                            : 'bg-[#4285f4] hover:bg-[#3367d6] text-white'
                        }`}
                      >
                        {senderParam ? '🔐 Sign in with Google to Send' : '🔐 Login with Google'}
                      </Button>
                      {!senderParam && (
                        <p className="text-muted-foreground text-sm">Or paste a JWT manually below</p>
                      )}
                    </div>
                  )}

                  {zkAddress && (
                    <div className="bg-primary/10 border border-primary/30 p-3 rounded-lg">
                      <strong className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">zkLogin Address:</strong>
                      <AddressDisplay address={zkAddress} size="sm" />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="zk-recipient">Recipient</Label>
                    <Input
                      id="zk-recipient"
                      required
                      value={form.recipient}
                      onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value.trim() }))}
                      placeholder="0x..."
                      className="bg-input border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zk-amount">Amount (SUI)</Label>
                    <Input
                      id="zk-amount"
                      required
                      type="number"
                      min="0"
                      step="0.000001"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                      placeholder="0.1"
                      className="bg-input border-border"
                    />
                    {Number(form.amount) > 100 && (
                      <span className="text-yellow-500 text-xs">⚠️ Large amount - confirm before sending</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jwt">JWT (from OAuth provider)</Label>
                    <Textarea
                      id="jwt"
                      value={jwtToken}
                      onChange={(e) => setJwtToken(e.target.value.trim())}
                      placeholder="Paste the OAuth JWT here or use Google login above"
                      rows={3}
                      className="bg-input border-border font-mono text-xs"
                    />
                  </div>

                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-2">
                      Advanced Options
                    </summary>
                    <div className="space-y-3 pt-3">
                      <div className="space-y-2">
                        <Label htmlFor="salt">Salt (optional)</Label>
                        <Input
                          id="salt"
                          value={salt}
                          onChange={(e) => setSalt(e.target.value.trim())}
                          placeholder="Leave blank to fetch from salt service"
                          className="bg-input border-border"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">Using {SUI_NETWORK} network</p>
                    </div>
                  </details>

                  {gasEstimate && (
                    <div className="bg-muted/50 p-3 rounded-lg text-sm text-muted-foreground">
                      Estimated gas: ~{gasEstimate} SUI
                    </div>
                  )}

                  <div className="space-y-3 pt-2">
                    <Button 
                      type="submit" 
                      disabled={!jwtToken}
                      className="w-full gradient-button text-primary-foreground font-semibold py-6"
                    >
                      {zkStatus ? 'Processing...' : 'Sign & Send with zkLogin'}
                    </Button>
                    {zkStatus && <div className="text-primary text-sm">{zkStatus}</div>}
                    {zkError && <div className="text-destructive text-sm">{zkError}</div>}
                    {zkDigest && (
                      <div className="text-primary text-sm">
                        ✅ Digest:{' '}
                        <a 
                          href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${zkDigest}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="underline hover:text-primary/80"
                        >
                          {zkDigest.slice(0, 16)}...
                        </a>
                      </div>
                    )}
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Current Account Card */}
          <Card className="bg-card border-border h-fit">
            <CardHeader className="pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Wallet</p>
              <CardTitle className="text-xl">Current account</CardTitle>
            </CardHeader>
            <CardContent>
              {account ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Address</p>
                    <AddressDisplay address={account.address} />
                  </div>
                  {account.label && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Wallet</p>
                      <p className="text-sm">{account.label}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">Connect a wallet to start.</p>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
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

async function fetchSaltFromService(jwt: string, telegramId?: string): Promise<{
  salt: string;
  derivedAddress?: string;
  provider?: string;
  subject?: string;
  keyClaimName?: string;
}> {
  const res = await fetch(SALT_SERVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jwt,
      telegramId
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Salt service error ${res.status}`);
  }

  const data = await res.json();
  if (!data?.salt) {
    throw new Error('Salt service did not return a salt');
  }
  return data;
}

/**
 * Normalize a salt string into bigint + canonical string form.
 * Accepts decimal or hex (with/without 0x).
 */
function normalizeSalt(rawSalt: string): { saltBigInt: bigint; saltString: string } {
  const trimmed = rawSalt.trim();
  let saltBigInt: bigint;

  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    saltBigInt = BigInt(trimmed);
  } else if (/^[0-9a-fA-F]+$/.test(trimmed) && /[a-fA-F]/.test(trimmed)) {
    // Hex without 0x
    saltBigInt = BigInt('0x' + trimmed);
  } else {
    // Assume decimal string
    saltBigInt = BigInt(trimmed);
  }

  return { saltBigInt, saltString: saltBigInt.toString() };
}

