// The codes the fields are stored in, shared by fields.mjs (writing) and render.mjs (reading).

/** Land cover class -> code (0: none). */
export const COVER = { "Temperate Forest": 1, "Boreal Forest": 2, "Tropical Forest": 3, Swamp: 4, Marsh: 4, Wetland: 4, Sand: 5, Glacier: 6, "Ice Sheet": 6, Ricefield: 7, "Blackened Earth": 8 };
/** Open dry grassland (the Shaar), from the painted map: not an atlas class. */
export const COVER_GRASSLAND = 9;
/** Köppen climate codes; a cell stores the index + 1 (0: none). */
export const CLIMATES = ["Af", "Am", "Aw", "As", "BSh", "BSk", "BWh", "BWk", "Cfa", "Cfb", "Cfc", "Csa", "Csb", "Csc", "Cwa", "Cwb", "Cwc", "Dfa", "Dfb", "Dfc", "Dfd", "Dsa", "Dsb", "Dsc", "Dwa", "Dwb", "Dwc", "Dwd", "EF", "ET"];
