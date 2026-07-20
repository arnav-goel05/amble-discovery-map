import { feverAdapter } from "./fever.mjs";
import { visitSingaporeAdapter } from "./visit-singapore.mjs";
import { singaporeFilmSocietyAdapter } from "./singapore-film-society.mjs";
import { rootsHanAdapter } from "./roots-han.mjs";
import { honeycombersAdapter } from "./honeycombers.mjs";
import { artsEquatorAdapter } from "./arts-equator.mjs";
import { timeOutSingaporeAdapter } from "./time-out-singapore.mjs";

const adapters = new Map(
  [
    feverAdapter,
    visitSingaporeAdapter,
    singaporeFilmSocietyAdapter,
    rootsHanAdapter,
    honeycombersAdapter,
    artsEquatorAdapter,
    timeOutSingaporeAdapter,
  ].map((adapter) => [adapter.id, adapter]),
);
export const renderedAdapterFor = (adapterId) =>
  adapters.get(adapterId) ?? null;
export {
  feverAdapter,
  visitSingaporeAdapter,
  singaporeFilmSocietyAdapter,
  rootsHanAdapter,
  honeycombersAdapter,
  artsEquatorAdapter,
  timeOutSingaporeAdapter,
};
