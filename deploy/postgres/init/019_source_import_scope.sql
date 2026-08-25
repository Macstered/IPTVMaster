-- Some providers are kept only for their films, and importing tens of
-- thousands of channels from them is pure cost. Others are live-only and
-- should not spend any effort indexing a catalogue nobody will publish.
--
-- Both default to on, which is what every existing provider was already doing.

ALTER TABLE source
  ADD COLUMN import_live BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN import_catalogue BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN source.import_live IS
  'Whether live channels are imported. Off for a provider kept only for its '
  'film or series catalogue.';

COMMENT ON COLUMN source.import_catalogue IS
  'Whether film and series categories are indexed during a refresh. Off skips '
  'the catalogue entirely; it does not affect categories already enabled, '
  'which stop being refreshed until it is turned back on.';
