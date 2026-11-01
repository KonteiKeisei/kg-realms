export const WATCH_ROLL_MS = 2000;

// These are harmless interruptions. They never create encounters, spend supplies or deal damage.
export const HARMLESS_WATCH_OUTCOMES = [
  "A squirrel drops from a low branch onto your shoulder. You nearly unsheathe your dagger before it scrambles down your back and into the brush.",
  "A burlap sack starts slowly inching away from the fire. You nearly kick someone awake to sound the alarm before realizing a field mouse is just dragging the empty oats bag.",
  "Something yanks the hem of your coat in the dark. You spin around with your weapon raised, only to spend five minutes trying to unhook yourself from a tent peg.",
  "A cooking pot spontaneously tips over in the dead of night, its spoon clattering loudly. You spend ten minutes staring at it from your post with your weapon drawn.",
  "A loud metallic scraping noise echoes through the quiet camp. You creep over, sweating bullets, only to find a dung beetle trapped inside a tin cup.",
  "The rhythmic slap of footsteps approaches your post. You step out to confront the assassin, only to aggressively tie a better knot on a loose, flapping tent cord.",
  "A sinister scratching comes from beneath the closest bedroll. You brace yourself for a burrowing ambush, but a cricket just hops out, looks up at you, and goes right back under.",
  "A heavy footstep lands right behind you. You spin around, adrenaline surging, to find a single boot that just tumbled off a leaning backpack.",
  "You pace past the dead campfire, and the cooling kettle lid violently pops. You flinch backwards and definitely do not let out a high-pitched squeak.",
  "A massive moth kamikazes directly into your eyeball. Your ensuing display of frantic shadowboxing to fight it off goes thankfully unseen by the sleeping party.",
  "Your scabbard catches on a branch as you turn, making the entire bush violently shake. You spend the next hour in a tense standoff with a piece of shrubbery.",
  "A sharp metallic tink makes you drop to a crouch for cover. After patting yourself down for arrows, you realize a loose belt buckle just slid off a pack and hit a mug.",
  "A nightbird repeats the same maddening chirp until you bend down to find a rock to throw at it. Someone in camp mutters the exact same chirp in their sleep, making you question your sanity.",
  "A cold weight settles on the toe of your boot. You freeze mid-stride, mentally writing your will over a venomous snakebite, until a tiny lizard gets bored and waddles away.",
  "You shift your weight, knocking two loud pebbles down the embankment. You freeze completely still for the rest of your shift, convinced the hill is plotting against you.",
  "A phantom shape suddenly inflates and rises beside the tents. You nearly smite an empty grain sack before pinning it under your boot to assert dominance.",
  "A nearly invisible thread brushes your cheek as you pace the perimeter. You assume a giant spider has found you, violently swatting your own face until you clear the stray spiderweb.",
  "A cooling log in the firepit fractures with a crack like a gunshot. You jump, sloshing hot tea from your mug down your own leg, and pretend it was a calculated tactical maneuver.",
  "A steady tapping noise starts up. You creep toward the armor pile, convinced a rogue is picking a lock, only to angrily shove a backpack so its dangling strap stops hitting a shield in the wind.",
  "A wet, heavy smack lands right next to your boot. You flinch so hard you pull a calf muscle, looking down to see a very embarrassed frog walking away instead of jumping.",
  "A slow, rhythmic metallic pinging starts driving you mad. After sweeping the perimeter twice, you realize it's tent condensation dripping onto a plate, which you violently kick three inches to the left.",
  "A large shape launches itself from a rolled cloak directly into the wash bucket. You rush over with your spear to drown the intruder, only to find a mildly inconvenienced grasshopper.",
  "A looming, monstrous silhouette slides across the tent fabric. You draw your sword to face the beast, only to realize you just stepped slightly too close to the lantern and projected your own shadow.",
  "A stacked wooden bowl slips, clatters, and begins spinning on its rim for what feels like three consecutive hours. You stand there rigidly, paralyzed, praying it doesn't wake anyone up."
];

export function harmlessWatchOutcome(random = Math.random) {
  return HARMLESS_WATCH_OUTCOMES[Math.min(HARMLESS_WATCH_OUTCOMES.length - 1, Math.floor(random() * HARMLESS_WATCH_OUTCOMES.length))];
}

/** An unqueued watch still rolls a real die. A 1 is a harmless failure, never an encounter. */
export function ambientWatchResult(die, roll, random = Math.random) {
  return { die, roll, harmless: true, text: roll === 1 ? harmlessWatchOutcome(random) : "A quiet watch." };
}
