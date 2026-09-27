export function ExchangeSecurityWarning(): JSX.Element {
  return (
    <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
      <p className="font-medium">Security Notice</p>
      <ul className="mt-1 list-disc pl-4">
        <li>Never share your API secret or private keys</li>
        <li>Use trade-only permissions, disable withdrawal</li>
        <li>Credentials are stored securely server-side, never exposed in frontend</li>
        <li>Enable IP allowlist on your exchange if supported</li>
      </ul>
    </div>
  );
}
