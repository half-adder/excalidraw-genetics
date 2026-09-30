// The first-load offers, in order: the font setup first, then the script
// migration (each waits for the one before it, so two prompts never open at
// once). A failed font setup is recorded and does not stop the migration
// offer; once the plugin is unloaded (e.g. during the font prompt), the
// migration offer is not started.
export async function runFirstLoadOffers(offers: {
  font: () => Promise<void>;
  migration: () => Promise<void>;
  record: (name: string, error: unknown) => void;
  unloaded: () => boolean;
}): Promise<void> {
  try { await offers.font(); } catch (e) { offers.record("Font setup", e); }
  if (offers.unloaded()) return;
  try { await offers.migration(); } catch (e) { offers.record("Migration", e); }
}
