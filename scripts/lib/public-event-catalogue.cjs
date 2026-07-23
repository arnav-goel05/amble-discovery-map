"use strict";

function projectPublicEventCatalogue(catalogue) {
  if (!catalogue || typeof catalogue !== "object" || Array.isArray(catalogue))
    return catalogue;
  const { mapped: _mapped, offMap, ...publicCatalogue } = catalogue;
  return {
    ...publicCatalogue,
    offMap: Array.isArray(offMap) ? offMap : [],
  };
}

module.exports = { projectPublicEventCatalogue };
