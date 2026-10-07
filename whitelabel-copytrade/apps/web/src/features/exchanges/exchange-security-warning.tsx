export function ExchangeSecurityWarning(): JSX.Element {
  return (
    <div className="rounded border border-yellow-200 bg-yellow-50 p-4 text-xs text-yellow-800 space-y-2">
      <p className="font-semibold">Non-Custodial Exchange Credential Security Notice</p>
      <ul className="list-disc pl-4 space-y-1">
        <li>Never share your exchange credentials or private keys with anyone</li>
        <li>Configure API keys with trade-only and read permissions; disable withdrawal and internal transfer</li>
        <li>Credentials are envelope-encrypted server-side with tenant AAD and never exposed in the frontend</li>
        <li>Enable IP allowlisting on your exchange venue (Binance, Bybit, OKX, Kraken, Coinbase) where supported</li>
      </ul>
    </div>
  );
}
