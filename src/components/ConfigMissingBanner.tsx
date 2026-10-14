import React from 'react';
import { AlertTriangle, Key, Database, RefreshCw, ExternalLink } from 'lucide-react';
import { isFirebaseConfigured, missingFirebaseConfigs } from '../firebase';

interface ConfigMissingBannerProps {
  hasGeminiKey: boolean;
  onRefresh?: () => void;
}

export const ConfigMissingBanner: React.FC<ConfigMissingBannerProps> = ({
  hasGeminiKey,
  onRefresh,
}) => {
  const isMissingAny = !isFirebaseConfigured || !hasGeminiKey;

  if (!isMissingAny) return null;

  return (
    <div className="bg-amber-950/80 border-b border-amber-500/40 px-4 py-2.5 text-amber-200 text-xs backdrop-blur-md">
      <div className="max-w-xl mx-auto flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-1">
          <p className="font-semibold text-amber-300">Environment Setup Notice</p>
          <div className="text-[11px] text-amber-300/90 space-y-0.5">
            {!isFirebaseConfigured && (
              <p className="flex items-center gap-1.5">
                <Database className="w-3 h-3 text-amber-400" />
                Missing Firebase configuration: {missingFirebaseConfigs.join(', ')}. Configure in <code className="bg-amber-900/50 px-1 py-0.5 rounded font-mono">.env</code>.
              </p>
            )}
            {!hasGeminiKey && (
              <p className="flex items-center gap-1.5">
                <Key className="w-3 h-3 text-amber-400" />
                <code className="bg-amber-900/50 px-1 py-0.5 rounded font-mono">GEMINI_API_KEY</code> is not detected. AI vision matching will run in manual fallback mode until set in Secrets panel.
              </p>
            )}
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-lg bg-amber-800/40 hover:bg-amber-700/60 text-amber-200 transition-colors"
            title="Check configuration again"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
