import {rmSync} from 'node:fs';
// Never deploy stale regional HTML after withdrawing or narrowing publication.
rmSync(new URL('../dist/', import.meta.url), {recursive:true, force:true});
