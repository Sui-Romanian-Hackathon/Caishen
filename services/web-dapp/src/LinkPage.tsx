import { useEffect, useState, useCallback } from 'react';
import {
  ConnectButton,
  useCurrentAccount,
  useSuiClient
} from '@mysten/dapp-kit';
import {
  generateNonce,
  generateRandomness,
  jwtToAddress
} from '@mysten/sui/zklogin';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AddressDisplay } from '@/components/AddressDisplay';

// Configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://caishen.iseethereaper.com';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const TELEGRAM_BOT_USERNAME =
  import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'Caishen_Sui_Bot';
const SALT_SERVICE_URL = import.meta.env.VITE_ZKLOGIN_SALT_SERVICE_URL || 'https://salt.api.mystenlabs.com/get_salt';
const PLACEHOLDER_SALT = import.meta.env.VITE_PLACEHOLDER_SALT_ZKLOGIN || '';

interface LinkingSession {
  token: string;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  status: 'pending_wallet' | 'pending_telegram_confirm' | 'completed';
  expiresAt: number;
  walletAddress: string | null;
  walletType: string | null;
}

type Step = 'loading' | 'choose_wallet' | 'zklogin_flow' | 'telegram_verify' | 'completed' | 'error';

export function LinkPage() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();

  // Parse token from URL
  const [token] = useState<string | null>(() => {
    const url = new URL(window.location.href);
    return url.searchParams.get('token');
  });

  const [session, setSession] = useState<LinkingSession | null>(null);
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // zkLogin state
  const [zkAddress, setZkAddress] = useState<string | null>(null);
  const [zkSalt, setZkSalt] = useState<string | null>(null);
  const [zkSub, setZkSub] = useState<string | null>(null);

  // Clear all cached state on mount - ensures fresh start every time
  useEffect(() => {
    // Clear zkLogin cached data
    sessionStorage.removeItem('zklogin_link');
    sessionStorage.removeItem('zklogin_eph');
    
    // Clear any other cached session data
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith('zklogin') || key.startsWith('sui'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
    
    console.log('[LinkPage] Cleared cached session data for fresh start');
  }, []); // Run once on mount

  // Load session on mount
  useEffect(() => {
    if (!token) {
      setError('No linking token provided. Please start from Telegram with /start');
      setStep('error');
      return;
    }

    const loadSession = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/link/${token}`);
        if (!res.ok) {
          // Fallback: if backend token store is unavailable, allow flow to continue locally
          const pathParts = window.location.pathname.split('/');
          const handle = pathParts[pathParts.length - 1] || null;
          setSession({
            token,
            telegramUsername: handle && handle.startsWith('@') ? handle.slice(1) : handle,
            telegramFirstName: null,
            status: 'pending_wallet',
            expiresAt: Date.now() + 15 * 60_000,
            walletAddress: null,
            walletType: null
          });
          setError(null);
          setStep('choose_wallet');
          return;
        }

        const data = await res.json();
        setSession(data);

        // Determine current step based on session status
        if (data.status === 'completed') {
          setStep('completed');
        } else if (data.status === 'pending_telegram_confirm') {
          setStep('telegram_verify');
        } else {
          setStep('choose_wallet');
        }
      } catch (err) {
        // Network error: still allow local flow
        const pathParts = window.location.pathname.split('/');
        const handle = pathParts[pathParts.length - 1] || null;
        setSession({
          token,
          telegramUsername: handle && handle.startsWith('@') ? handle.slice(1) : handle,
          telegramFirstName: null,
          status: 'pending_wallet',
          expiresAt: Date.now() + 15 * 60_000,
          walletAddress: null,
          walletType: null
        });
        setError(null);
        setStep('choose_wallet');
      }
    };

    loadSession();
  }, [token]);

  // Check for OAuth callback (JWT in URL hash)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('id_token=')) {
      const match = hash.match(/id_token=([^&]+)/);
      if (match) {
        const jwt = decodeURIComponent(match[1]);
        handleZkLoginCallback(jwt);
        // Clear hash
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
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

  // Track if user manually initiated wallet connection
  const [userInitiatedConnection, setUserInitiatedConnection] = useState(false);

  // Handle Slush wallet connection - ONLY if user manually initiated
  useEffect(() => {
    if (
      userInitiatedConnection &&
      account?.address && 
      step === 'choose_wallet' && 
      session?.status === 'pending_wallet'
    ) {
      connectWallet(account.address, 'slush');
      setUserInitiatedConnection(false); // Reset after connecting
    }
  }, [account, step, session, userInitiatedConnection]);

  const connectWallet = async (address: string, type: 'zklogin' | 'slush' | 'external') => {
    if (!token) return;

    setStatus('Connecting wallet...');
    try {
      const body: Record<string, string | undefined> = {
        walletAddress: address,
        walletType: type
      };

      if (type === 'zklogin') {
        body.zkLoginSalt = zkSalt || undefined;
        body.zkLoginSub = zkSub || undefined;
      }

      const res = await fetch(`${API_BASE_URL}/api/link/${token}/wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        // Fallback: proceed locally even if backend update fails
        setSession(prev => prev ? { ...prev, status: 'pending_telegram_confirm', walletAddress: address, walletType: type } : null);
        setStep('telegram_verify');
        setStatus(null);
        return;
      }

      setSession(prev => prev ? { ...prev, status: 'pending_telegram_confirm', walletAddress: address, walletType: type } : null);
      setStep('telegram_verify');
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
      setStatus(null);
    }
  };

  // Start Google OAuth for zkLogin
  const startZkLogin = useCallback(async () => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Google Client ID not configured');
      return;
    }

    try {
      setStatus('Starting zkLogin...');

      // Generate ephemeral keypair
      const eph = Ed25519Keypair.generate();

      // Get current epoch
      const { epoch } = await suiClient.getLatestSuiSystemState();
      const maxEp = Number(epoch) + 2;

      // Generate nonce
      const rand = generateRandomness();
      const nonce = generateNonce(eph.getPublicKey(), maxEp, rand);

      // Store for callback
      sessionStorage.setItem('zklogin_link', JSON.stringify({
        secretKey: Array.from(eph.getSecretKey()),
        maxEpoch: maxEp,
        randomness: rand.toString(),
        token: token
      }));

      // Build OAuth URL - redirect back to this page
      const redirectUri = `${window.location.origin}${window.location.pathname}?token=${token}`;
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'id_token',
        scope: 'openid',
        nonce: nonce
      });

      setStatus('Redirecting to Google...');
      window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start zkLogin');
      setStatus(null);
    }
  }, [suiClient, token]);

  // Handle zkLogin OAuth callback
  const handleZkLoginCallback = async (jwt: string) => {
    try {
      setStep('zklogin_flow');
      setStatus('Processing Google authentication...');

      // Restore stored data
      const stored = sessionStorage.getItem('zklogin_link');
      if (!stored) {
        throw new Error('Session data lost. Please try again.');
      }
      sessionStorage.removeItem('zklogin_link');

      // Decode JWT to get sub
      const { sub, aud } = decodeJwt(jwt);
      if (!sub) {
        throw new Error('Invalid JWT - missing subject');
      }
      setZkSub(sub);

      // Fetch salt
      setStatus('Fetching zkLogin salt...');
      const saltResult = await fetchSalt(jwt);
      const { saltBigInt, saltString } = normalizeSalt(saltResult.salt);
      setZkSalt(saltString);
      if (saltResult.usedFallback) {
        setStatus('Using placeholder salt from environment (offline fallback)...');
      }

      // Derive address
      const address = jwtToAddress(jwt, saltBigInt);
      setZkAddress(address);

      setStatus('Wallet ready! Now connecting...');

      // Connect the zkLogin wallet
      await connectWallet(address, 'zklogin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'zkLogin failed');
      setStep('error');
      setStatus(null);
    }
  };

  // Load Telegram Login Widget
  useEffect(() => {
    if (step !== 'telegram_verify') return;

    // Add Telegram widget script
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', TELEGRAM_BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    script.async = true;

    // Create callback function
    (window as unknown as { onTelegramAuth: (user: unknown) => void }).onTelegramAuth = async (user: unknown) => {
      await verifyTelegram(user as Record<string, string | number>);
    };

    const container = document.getElementById('telegram-login-container');
    if (container) {
      container.innerHTML = '';
      container.appendChild(script);
    }

    return () => {
      delete (window as unknown as { onTelegramAuth?: unknown }).onTelegramAuth;
    };
  }, [step]);

  // Verify Telegram auth
  const verifyTelegram = async (authData: Record<string, string | number>) => {
    if (!token) return;

    setStatus('Verifying your Telegram account...');
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/link/${token}/telegram-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authData)
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const message = data?.error
          ? `Verification failed: ${data.error}`
          : 'Verification failed. Please return to Telegram and try again.';
        setError(message);
        setStep('error');
        setStatus(null);
        return;
      }

      setSession(prev => prev ? {
        ...prev,
        status: 'completed',
        walletAddress: data?.walletAddress || prev.walletAddress,
        walletType: data?.walletType || prev.walletType
      } : null);
      setStep('completed');
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
      setStatus(null);
      setStep('error');
    }
  };

  // Reset local flow so user can start over without leaving the page
  const resetLinkingFlow = () => {
    setError(null);
    setStatus(null);
    setZkAddress(null);
    setZkSalt(null);
    setZkSub(null);
    sessionStorage.removeItem('zklogin_link');
    setSession(prev => prev ? {
      ...prev,
      status: 'pending_wallet',
      walletAddress: null,
      walletType: null
    } : prev);
    setStep('choose_wallet');
  };

  // Render based on step
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="max-w-xl mx-auto w-full p-6 flex-1 flex flex-col">
        {/* Header */}
        <header className="text-center mb-8">
          <p className="text-xs text-primary uppercase tracking-wider mb-3">Caishen</p>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Connect Your Wallet
          </h1>
          {session && (
            <p className="text-muted-foreground">
              Welcome{session.telegramFirstName ? `, ${session.telegramFirstName}` : ''}!
              {session.telegramUsername && <span className="text-primary"> (@{session.telegramUsername})</span>}
            </p>
          )}
        </header>

        {/* Main Content */}
        <main className="flex-1">
          {step === 'loading' && (
            <Card className="bg-card border-border">
              <CardContent className="py-12">
                <div className="text-center text-primary">Loading...</div>
              </CardContent>
            </Card>
          )}

          {step === 'error' && (
            <Card className="bg-destructive/5 border-destructive/30">
              <CardHeader>
                <CardTitle className="text-xl">Error</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-destructive">{error}</p>
                <div className="flex flex-col gap-3">
                  <Button onClick={resetLinkingFlow} variant="secondary">
                    Try Again
                  </Button>
                  <Button asChild variant="outline">
                    <a href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=reset`}>
                      Get a Fresh Link in Telegram
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {step === 'choose_wallet' && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-xl">Step 1: Choose Your Wallet</CardTitle>
                <CardDescription>Select how you want to connect your wallet</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* zkLogin Option */}
                <div className="p-5 border border-border rounded-xl text-center space-y-4">
                  <h3 className="text-lg font-semibold">🔐 Create zkLogin Wallet</h3>
                  <p className="text-muted-foreground text-sm">
                    Use your Google account to create a new wallet. No seed phrases needed!
                  </p>
                  <Button 
                    onClick={startZkLogin}
                    className="gradient-button text-primary-foreground font-semibold"
                  >
                    Continue with Google
                  </Button>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-4 text-muted-foreground">
                  <div className="flex-1 h-px bg-border"></div>
                  <span className="text-sm">OR</span>
                  <div className="flex-1 h-px bg-border"></div>
                </div>

                {/* External Wallet Option */}
                <div className="p-5 border border-border rounded-xl text-center space-y-4">
                  <h3 className="text-lg font-semibold">👛 Use Existing Wallet</h3>
                  <p className="text-muted-foreground text-sm">
                    Connect your Slush wallet or any other Sui-compatible wallet
                  </p>
                  <div onClick={() => setUserInitiatedConnection(true)}>
                    <ConnectButton />
                  </div>
                </div>

                {status && <div className="text-center text-primary text-sm">{status}</div>}
                {error && <div className="text-center text-destructive text-sm">{error}</div>}
              </CardContent>
            </Card>
          )}

          {step === 'zklogin_flow' && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-xl">Creating Your Wallet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center text-primary py-4">{status || 'Processing...'}</div>
                {zkAddress && (
                  <div className="bg-muted/50 p-4 rounded-lg text-center">
                    <strong className="block text-xs text-muted-foreground mb-2">Your new wallet address:</strong>
                    <AddressDisplay address={zkAddress} />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {step === 'telegram_verify' && (
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-xl">Step 2: Verify Your Telegram</CardTitle>
                <CardDescription>
                  Click below to confirm this is your Telegram account
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {session?.walletAddress && (
                  <div className="flex items-center justify-center gap-2 p-3 bg-primary/10 rounded-lg text-sm">
                    <span className="text-primary">✓</span>
                    Wallet connected: <AddressDisplay address={session.walletAddress} size="sm" />
                  </div>
                )}

                <div id="telegram-login-container" className="flex justify-center py-6 min-h-[60px]">
                  {/* Telegram widget loads here */}
                </div>

                {status && <div className="text-center text-primary text-sm">{status}</div>}
                {error && <div className="text-center text-destructive text-sm">{error}</div>}

                <p className="text-center text-xs text-muted-foreground">
                  This confirms you own this Telegram account. Your data is verified using
                  Telegram's secure authentication system.
                </p>
              </CardContent>
            </Card>
          )}

          {step === 'completed' && (
            <Card className="bg-primary/5 border-primary/30 text-center">
              <CardContent className="py-8 space-y-6">
                <div className="text-5xl">✅</div>
                <div>
                  <h2 className="text-2xl font-bold text-foreground mb-2">All Done!</h2>
                  <p className="text-muted-foreground">Your wallet is now linked to your Telegram account.</p>
                </div>

                {session?.walletAddress && (
                  <div className="bg-muted/50 p-4 rounded-lg text-left space-y-2">
                    <div><strong className="text-muted-foreground">Telegram:</strong> @{session.telegramUsername}</div>
                    <div className="flex flex-col gap-1">
                      <strong className="text-muted-foreground">Wallet:</strong>
                      <AddressDisplay address={session.walletAddress} size="sm" />
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 pt-2">
                  <Button asChild className="gradient-button text-primary-foreground font-semibold">
                    <a href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=linked`}>
                      Return to Telegram Bot
                    </a>
                  </Button>
                  <Button onClick={resetLinkingFlow} variant="secondary">
                    Connect Different Wallet
                  </Button>
                  <Button asChild variant="outline">
                    <a href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=reset`}>
                      Get a New Linking URL
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </main>

        {/* Footer */}
        <footer className="text-center py-6 mt-8">
          <p className="text-muted-foreground text-xs">Powered by Sui zkLogin • Secure & Non-Custodial</p>
        </footer>
      </div>
    </div>
  );
}

// Utility functions
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

async function fetchSalt(jwt: string): Promise<{ salt: string; usedFallback: boolean }> {
  try {
    const res = await fetch(SALT_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Mysten salt API expects `token`; keep `jwt` for compatibility.
      body: JSON.stringify({ token: jwt, jwt })
    });
    if (!res.ok) {
      throw new Error(`Salt service error ${res.status}`);
    }
    const data = await res.json();
    if (!data?.salt) throw new Error('Salt not returned');
    return { salt: String(data.salt), usedFallback: false };
  } catch (err) {
    if (PLACEHOLDER_SALT) {
      console.warn('Salt fetch failed, using placeholder salt from env.', err);
      return { salt: PLACEHOLDER_SALT, usedFallback: true };
    }
    throw err;
  }
}

function normalizeSalt(rawSalt: string): { saltBigInt: bigint; saltString: string } {
  const trimmed = rawSalt.trim();
  let saltBigInt: bigint;

  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    saltBigInt = BigInt(trimmed);
  } else if (/^[0-9a-fA-F]+$/.test(trimmed) && /[a-fA-F]/.test(trimmed)) {
    saltBigInt = BigInt('0x' + trimmed);
  } else {
    saltBigInt = BigInt(trimmed);
  }

  return { saltBigInt, saltString: saltBigInt.toString() };
}
