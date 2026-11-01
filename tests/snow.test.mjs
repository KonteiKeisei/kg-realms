import { test } from "node:test";
import assert from "node:assert/strict";
import { snowLineAt, yearFraction, SNOW_LINE } from "../scripts/snow.mjs";

const months = Array.from({ length: 12 }, () => ({ days: 30 }));
const at = (month, day) => snowLineAt(yearFraction({ month, dayOfMonth: day - 1 }, { monthsArray: months }));

test("mid-month the snow line sits on that month's landmarks", () => {
  const hammer = at(0, 15.5);
  assert.ok(Math.abs(hammer.full - SNOW_LINE[0][0]) < 1 && Math.abs(hammer.bare - SNOW_LINE[0][1]) < 1);
  const flamerule = at(6, 15.5);
  assert.ok(flamerule.bare < 400, "midsummer: bare south of Icewind Dale");
});

test("the line moves north through spring and south through autumn, a little each day", () => {
  const spring = [2, 3, 4].map((m) => at(m, 15).bare);
  assert.ok(spring[0] > spring[1] && spring[1] > spring[2]);
  const autumn = [8, 9, 10].map((m) => at(m, 15).bare);
  assert.ok(autumn[0] < autumn[1] && autumn[1] < autumn[2]);
  const a = at(2, 10).bare, b = at(2, 11).bare;
  assert.ok(a > b && a - b < 40, "one day moves it a few miles");
});

test("the year wraps: late Nightal runs into Hammer", () => {
  const nightal = at(11, 30), hammer = at(0, 1);
  assert.ok(Math.abs(nightal.bare - hammer.bare) < 60);
});

test("year fraction reads Calendaria's month list or Foundry's", () => {
  assert.equal(yearFraction({ month: 6, dayOfMonth: 0 }, { months: { values: { a: { days: 30 } } } }) > 0, true);
  assert.equal(yearFraction(null), 0);
});
