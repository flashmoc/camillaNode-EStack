# Advanced

Advanced is a read-only live topology inspector, not a second DSP editor.
It calls only `EStackDSPBridge.command('GetConfigJson')`. No mock adapter,
SetConfigJson, SetVolume or configuration mutation is exposed.

The page presents capture/playback devices, channels, sample rate, chunksize,
ordered pipeline stages, Mixer/Filter/Processor references and all configured
definitions. Expandable details retain exact parameters and mixer mappings.
Ownership hints link known E-Stack anchors to Input, Output, Control or Loudness;
unrecognized definitions remain system inspection rather than invented controls.
Ownership hints describe purpose and are not mutation authority.

Raw JSON is a secondary read-only disclosure. Search, expanded sections and
scroll are preserved while unchanged live snapshots are polled. Failed refreshes
explicitly label retained details as the last successful snapshot.
Phone uses stacked disclosures, without a wide topology table.

Software verification uses live demo config comparisons, a no-write WebSocket
assertion and mobile layout checks. Raspberry hardware acceptance is pending.
