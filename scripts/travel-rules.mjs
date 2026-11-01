const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const paragraphs = (...rows) => rows.map(([label, text]) => `<p><strong>${escape(label)}</strong> ${escape(text)}</p>`).join("");
export function ruleContent(text) {
  const value = String(text ?? "");
  if (!value.includes("<p>")) return `<p>${escape(value)}</p>`;
  // Only our paragraph and emphasis tags are allowed in Foundry's HTML tooltip.
  return value.replace(/<[^>]*>/g, (tag) => /^<\/?(?:p|strong|b)>$|^<br\s*\/?>$/i.test(tag) ? tag : escape(tag));
}
export function ruleTooltip(text) {
  const html = ruleContent(text), plain = html.replace(/<[^>]*>/g, " ").replace(/&(amp|lt|gt|quot|#39);/g, (_, k) => ({amp:"&",lt:"<",gt:">",quot:'"',"#39":"'"})[k]).replace(/\s+/g, " ").trim();
  return `<span class="kgr-rule" data-tooltip="${escape(html)}" data-tooltip-class="kgr-rule-tip" aria-label="${escape(plain)}" tabindex="0">?</span>`;
}

/** Short, labelled paragraphs shared by tooltips and the read-only player rules. */
/** Labelled paragraphs ([label, text] rows) for a rule tooltip, as the rules below. */
export const ruleParagraphs = (rows) => paragraphs(...rows);

export function travelRules(rules = "2014") {
  const y24 = rules === "2024";
  const pace = {
    fast: paragraphs(["Fast", "4 mph; 30 miles per day."], ["Checks", y24 ? "Disadvantage on Perception and Survival." : "Subtract 5 from passive Perception."]),
    normal: paragraphs(["Normal", "3 mph; 24 miles per day."], ["Checks", y24 ? "Disadvantage on Stealth." : "No pace modifier."]),
    slow: paragraphs(["Slow", "2 mph; 18 miles per day."], ["Checks", y24 ? "Advantage on Perception and Survival." : "The party can travel stealthily."])
  };
  return { rules, pace, paceAll: Object.values(pace).join(""),
    terrain: y24 ? paragraphs(["Pace limits", "Plains and grassland: fast. Forest, hills and desert: normal. Mountains, swamp and ice: slow."], ["Routes", "Roads remove the terrain cap. Trails raise it by one pace."]) : paragraphs(["Difficult terrain", "Forests, swamps, mountains and ice halve off-road progress."]),
    forced: paragraphs(["After 8 travel hours", "Each extra hour is a forced march."], ["Save", "At the end of each extra hour, every character makes a Constitution save. DC = 10 + hours travelled beyond 8."], ["Failure", "Gain one level of Exhaustion."]),
    method: paragraphs(["On foot", "The slowest walker sets the party's speed."], ["Other travel", "Mounts and wagons use travel pace. Coaches are faster on roads. Wagons and coaches stay on roads and trails. Flying mounts use their own speed and fly directly."]),
    methods: {
      foot: paragraphs(["Speed", "Use the slowest walking speed. A speed of 30 ft gives 3 mph at normal pace."]),
      mounted: paragraphs(["Speed", "Use travel pace."], ["Gallop", "For about one hour, a mount can cover twice the distance of fast pace."]),
      wagon: paragraphs(["Speed", "Travel pace. Encumbrance and slow walkers don't slow the party."], ["Routes", "Roads and trails only. Each stop must be next to one."], ["Cost", "Depends on the deal. The party might pay for the ride, ride free, or get paid to guard a caravan."]),
      coach: paragraphs(["Speed", "6 mph on roads at normal pace. Travel pace on trails. Encumbrance and slow walkers don't slow the party. The road speed is a house rule; the book uses wagon speed."], ["Routes", "Roads and trails only. Each stop must be next to one."], ["Cost", "3 cp per mile per person, the book's price. The party might also ride free, or get paid as an escort."]),
      flying: paragraphs(["Flight", "Use the configured speed. Travel directly over land and water; pace does not change it."]),
      custom: paragraphs(["Speed", "Use the configured speed. Terrain slows progress as it does for walking."])
    },
    vessels: paragraphs(["Rowed boats", "Rowboat: 1.5 mph. Keelboat: 1 mph. Travel lasts 8 hours per day."], ["Crewed ships", "Sailing ship: 2 mph. Warship: 2.5 mph. Longship: 3 mph. Galley: 4 mph. They sail 24 hours per day."]),
    fares: paragraphs(["Prices", "Per mile, per person. Ship: 1 sp. Coach: 3 cp. Wagon: free, or 2 cp if the party pays."], ["Getting paid", "Guarding a wagon pays 8 cp per mile. Escorting a coach pays 4 cp per mile. That's about 2 gp a day, a skilled hireling's wage."], ["GM", "These are starting numbers. Set the deal and rate for the journey, or change the price on one leg."]),
    water: paragraphs(["Winds and ocean currents", "Their influence extends 250 miles to either side of the line, during the listed seasons."], ["Direction", "With the flow: use its speed multiplier (normally 1.5). Against it: half speed. Across it: normal speed. Intermediate headings scale between these values."], ["Overlap", "Use the nearer wind or current."], ["Rivers", "Add current speed downstream and subtract it upstream, to a minimum of 0.5 mph. Rivers marked impassable cannot be used."]),
    sail: paragraphs(["Crewed ships", "The party rests aboard while the ship keeps moving. Make camp after going ashore."]),
    rest: paragraphs(["Long rest", "At least 8 hours, including 6 hours of sleep and no more than 2 hours of light activity, such as eating or keeping watch."], ["Interruptions", y24 ? "Rolling initiative, taking damage, casting a spell other than a cantrip, or one hour of exertion interrupts rest. After at least an hour, the rest can count as a short rest. Resume the long rest with one additional hour per interruption." : "An hour of walking, fighting, casting spells or similar exertion interrupts the rest. Begin the long rest again."], ["Limit", "One long rest per 24 hours."]),
    sleep: paragraphs(["Elves", y24 ? "Four hours of trance complete the long rest. They can watch during the other four hours." : "Four hours of trance provide the benefit of eight hours of sleep. They can watch during the other four hours."], ["Warforged", "Sentry's Rest requires six inactive hours, awake and aware. They can keep watch throughout the rest window."]),
    watch: paragraphs(["Camp schedule", "4 hours of setup, 8 hours of rest and watches, then 4 hours of packing. Extra camp hours wait after rest, before packing."], ["Watch duty", "Up to 2 hours of watch is light activity compatible with a normal long rest."], ["Noticing danger", "Use the watcher's passive Perception, or roll Perception when the GM requests it. Sleeping characters must be woken."]),
    shift: paragraphs(["Shared watches", "Members start together but keep their own assigned hours. The next shift starts when the last member finishes."], ["Perception", "The first member still awake makes the check. Reduce the DC by 5 for each additional awake member."], ["Encounter dice", "Each shift rolls a die with one more side than the number of watches remaining."]),
    forage: paragraphs(["When and where", "During setup, search within 100 feet of camp."], ["Check", "Survival. DC 10: plentiful food. 15: limited. 20: very little. 25: scarce. 30: desolate."], ["Help", "Choose a leader. Each successful helper adds 1; each failed helper subtracts 1."], ["Success", "One ration for each party member."], ["Book rule", "Foraging while travelling at normal or slow pace instead yields 1d6 + Wisdom modifier pounds of food and the same number of gallons of water."]),
    tasks: paragraphs(["Setup", "Choose one activity per character. A character cannot lead one activity and help with another."], ["Watch duty", "Choose watches separately. Setup workers may also watch, with disadvantage on checks during their own shift. Orange outlines identify them."], ["Help", "Each successful helper adds 1 to the leader's result. Each failed helper subtracts 1."], ["No watcher", "The camp is surprised by an encounter unless alarms are set."], ["GM ruling", "The GM can set an automatic outcome or override a roll, with a recorded reason."]),
    conceal: paragraphs(["Check", "Choose Survival -or- Stealth against the camp DC."], ["Success", "Each successful concealer adds 1 to the size of the watch encounter dice. These bonuses stack."], ["Failure", "No concealment bonus."]),
    alarm: paragraphs(["Setup", "Use tripwires, bells or another alarm."], ["Check", "Choose Survival -or- Sleight of Hand against the camp DC. Use one skill."], ["Success", "Reduce the night's Perception DC by 5. The camp cannot be surprised."], ["Magic or equipment", "The GM can declare automatic success, for example when an Alarm spell covers the camp."]),
    campRolls: paragraphs(["Timing", "The die rolls for 2 seconds, then shows its result."], ["Die size", "Watches remaining + 1, plus successful concealment checks. Three watches normally roll d4, d3 and d2."], ["A 1", "A queued encounter happens during that watch. Without a queued encounter, show a harmless camp interruption; it causes no damage or loss."], ["Other numbers", "A quiet watch. Keep the rolled number visible."], ["No watcher", "Roll once for the rest, using 1d(1 + concealment successes)."]),
    // A world's own sea lore (its definition's rules.seasons) replaces this (0.75.6).
    seasons: paragraphs(["Winds and currents", "Sailing with a wind or current is faster; against it, half speed. Each blows in the seasons the GM sets on the Waterways tab."], ["Out of season", "A wind or current outside its seasons is open sea."])
  };
}
