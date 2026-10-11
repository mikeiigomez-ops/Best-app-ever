window.UP_CONTENT = window.UP_CONTENT || {};
(window.UP_CONTENT.estimates = window.UP_CONTENT.estimates || []).push(
  // ---------- space (6) ----------
  { id: "es01", topic: "space", q: "How far away is the Moon, on average?", answer: 384400, unit: "km", min: 1000, max: 10000000, log: true, explain: "About 30 Earths would fit in the gap.", src: "NASA" },
  { id: "es02", topic: "space", q: "How many minutes does sunlight take to reach Earth?", answer: 8.3, unit: "min", min: 0.1, max: 1000, log: true, explain: "The Sun you see is the Sun of 8 minutes ago. Moonlight takes just 1.3 seconds.", src: "NASA" },
  { id: "es03", topic: "space", q: "About how many Earths could fit inside the Sun, by volume?", answer: 1300000, unit: "Earths", min: 1000, max: 1000000000, log: true, explain: "The Sun holds 99.8% of all the mass in the solar system.", src: "NASA" },
  { id: "es04", topic: "space", q: "How old is the universe, in billions of years?", answer: 13.8, unit: "billion yrs", min: 1, max: 100, log: true, explain: "Earth has existed for about a third of that time.", src: "NASA" },
  { id: "es05", topic: "space", q: "How many Earth days does Venus take to spin once on its axis?", answer: 243, unit: "days", min: 1, max: 10000, log: true, explain: "Longer than its year (225 days). A Venus day outlasts a Venus year.", src: "NASA" },
  { id: "es06", topic: "space", q: "About how many minutes does the ISS take to orbit Earth once?", answer: 92, unit: "min", min: 10, max: 2000, log: true, explain: "Astronauts see about 16 sunrises every day.", src: "NASA" },

  // ---------- science (6) ----------
  { id: "es07", topic: "science", q: "How many food calories (kcal) are in one gram of fat?", answer: 9, unit: "kcal", min: 1, max: 30, log: false, explain: "More than double carbs or protein (4 kcal per gram each).", src: "USDA" },
  { id: "es08", topic: "science", q: "At about what temperature does water boil on the summit of Everest?", answer: 71, unit: "°C", min: 30, max: 100, log: false, explain: "Low air pressure means boiling water there is too cool to cook pasta properly.", src: "Britannica" },
  { id: "es09", topic: "science", q: "About how many atoms are in an adult human body?", answer: 7e27, unit: "atoms", min: 1e15, max: 1e35, log: true, explain: "That's a 7 followed by 27 zeros, far more than stars in the observable universe.", src: "Royal Society of Chemistry" },
  { id: "es10", topic: "science", q: "How fast does sound travel through air at 20 °C, in meters per second?", answer: 343, unit: "m/s", min: 10, max: 10000, log: true, explain: "About 3 seconds per kilometer: count after lightning, divide by 3 for km.", src: "NIST" },
  { id: "es11", topic: "science", q: "How hot can a lightning bolt heat the air, in °F?", answer: 50000, unit: "°F", min: 1000, max: 1000000, log: true, explain: "About five times hotter than the surface of the Sun.", src: "NOAA" },
  { id: "es12", topic: "science", q: "If you uncoiled all the DNA in one of your cells, about how long would it be?", answer: 2, unit: "m", min: 0.001, max: 1000, log: true, explain: "Two meters packed into a nucleus far smaller than a grain of sand.", src: "NIH" },

  // ---------- earth (6) ----------
  { id: "es13", topic: "earth", q: "What percentage of Earth's atmosphere is nitrogen?", answer: 78, unit: "%", min: 0, max: 100, log: false, explain: "Oxygen is only about 21%. Most of every breath is gas your body ignores.", src: "NASA" },
  { id: "es14", topic: "earth", q: "About how deep is the deepest point of the ocean (Challenger Deep)?", answer: 11000, unit: "m", min: 100, max: 100000, log: true, explain: "Drop Everest in and its peak would still sit over 2 km underwater.", src: "NOAA" },
  { id: "es15", topic: "earth", q: "What percentage of Earth's water is fresh water?", answer: 2.5, unit: "%", min: 0.1, max: 100, log: true, explain: "And most of that is locked in ice and groundwater, not lakes and rivers.", src: "USGS" },
  { id: "es16", topic: "earth", q: "What percentage of Earth's surface is covered by ocean?", answer: 71, unit: "%", min: 0, max: 100, log: false, explain: "That's why Earth looks like a pale blue dot from deep space.", src: "NOAA" },
  { id: "es17", topic: "earth", q: "How old is Earth, in billions of years?", answer: 4.54, unit: "billion yrs", min: 0.01, max: 100, log: true, explain: "Squeeze it into one day and humans show up in the last few seconds.", src: "USGS" },
  { id: "es18", topic: "earth", q: "How fast is the ground at the equator moving due to Earth's spin?", answer: 1670, unit: "km/h", min: 10, max: 100000, log: true, explain: "Faster than the speed of sound, and you feel nothing.", src: "NASA" },

  // ---------- nature (6) ----------
  { id: "es19", topic: "nature", q: "About how long can a blue whale grow?", answer: 30, unit: "m", min: 1, max: 300, log: true, explain: "About the length of a basketball court: the largest animal known to have lived.", src: "NOAA Fisheries" },
  { id: "es20", topic: "nature", q: "How many hearts does an octopus have?", answer: 3, unit: "hearts", min: 0, max: 10, log: false, explain: "Two pump blood to the gills, one to the body. Its blood is blue.", src: "Smithsonian" },
  { id: "es21", topic: "nature", q: "How many teaspoons of honey does one worker bee make in its whole life?", answer: 0.083, unit: "tsp", min: 0.001, max: 10, log: true, explain: "About 1/12 of a teaspoon. Every jar is the life's work of hundreds of bees.", src: "National Honey Board" },
  { id: "es22", topic: "nature", q: "How long is an African elephant's pregnancy, in months?", answer: 22, unit: "months", min: 1, max: 60, log: true, explain: "The longest of any land mammal. Humans: 9 months.", src: "Smithsonian" },
  { id: "es23", topic: "nature", q: "How many vertebrae are in a giraffe's neck?", answer: 7, unit: "", min: 1, max: 50, log: true, explain: "The same as yours. Each one can be up to 25 cm long.", src: "Britannica" },
  { id: "es24", topic: "nature", q: "How many eyes does a honeybee have?", answer: 5, unit: "eyes", min: 0, max: 20, log: false, explain: "Two big compound eyes plus three tiny simple eyes on top of its head.", src: "Britannica" },

  // ---------- body (6) ----------
  { id: "es25", topic: "body", q: "How many bones are in the adult human body?", answer: 206, unit: "bones", min: 10, max: 2000, log: true, explain: "Babies are born with around 300; many fuse as they grow.", src: "Britannica" },
  { id: "es26", topic: "body", q: "About how many liters of blood are in an average adult?", answer: 5, unit: "L", min: 0.5, max: 50, log: true, explain: "Roughly a big jug and a half of milk. Your heart pumps all of it every minute.", src: "Cleveland Clinic" },
  { id: "es27", topic: "body", q: "About how many times does your heart beat in one day?", answer: 100000, unit: "beats", min: 1000, max: 10000000, log: true, explain: "About 2.5 billion beats over a typical lifetime.", src: "American Heart Association" },
  { id: "es28", topic: "body", q: "What share of your body's energy does your brain use at rest?", answer: 20, unit: "%", min: 0, max: 100, log: false, explain: "It's only about 2% of your body weight. Thinking is expensive.", src: "NIH" },
  { id: "es29", topic: "body", q: "About how many neurons are in the human brain, in billions?", answer: 86, unit: "billion", min: 0.1, max: 10000, log: true, explain: "More than ten for every person on Earth.", src: "J. Comp. Neurology (Azevedo 2009)" },
  { id: "es30", topic: "body", q: "WHO recommends adults get at least how many minutes of moderate activity per week?", answer: 150, unit: "min", min: 10, max: 1000, log: true, explain: "Just over 20 minutes of brisk walking a day gets you there.", src: "WHO" },

  // ---------- history (6) ----------
  { id: "es31", topic: "history", q: "About how many years passed between the Great Pyramid's building and Cleopatra's birth?", answer: 2500, unit: "years", min: 100, max: 10000, log: true, explain: "Cleopatra lived closer in time to the Moon landing than to the pyramid's construction.", src: "Britannica" },
  { id: "es32", topic: "history", q: "About how many years ago did the last woolly mammoths die out?", answer: 4000, unit: "years", min: 100, max: 1000000, log: true, explain: "On Wrangel Island, mammoths survived after the Great Pyramid was built.", src: "Britannica" },
  { id: "es33", topic: "history", q: "How many years did the Hundred Years' War actually last?", answer: 116, unit: "years", min: 10, max: 1000, log: true, explain: "England and France fought on and off from 1337 to 1453.", src: "Britannica" },
  { id: "es34", topic: "history", q: "How many years passed between the Wright brothers' first flight and the Moon landing?", answer: 66, unit: "years", min: 1, max: 1000, log: true, explain: "From 1903 to 1969: one lifetime from a wood-and-fabric biplane to walking on the Moon.", src: "Smithsonian" },
  { id: "es35", topic: "history", q: "How many seconds did the Wright brothers' first powered flight last?", answer: 12, unit: "s", min: 1, max: 1000, log: true, explain: "It covered 37 m, shorter than a Boeing 747's wingspan.", src: "Smithsonian" },
  { id: "es36", topic: "history", q: "About how many people died when the Titanic sank in 1912?", answer: 1500, unit: "people", min: 10, max: 100000, log: true, explain: "There were lifeboats for only about half the people on board.", src: "Britannica" },

  // ---------- money (6) ----------
  { id: "es37", topic: "money", q: "At 7% annual growth, how many years does it take money to double?", answer: 10.2, unit: "years", min: 1, max: 100, log: true, explain: "The Rule of 72: divide 72 by the rate. 72 / 7 ≈ 10.", src: "Compound interest math" },
  { id: "es38", topic: "money", q: "$1,000 invested at 7% a year, compounded, is worth how much after 30 years?", answer: 7612, unit: "$", min: 500, max: 100000, log: true, explain: "Over 7x. Most of the growth arrives in the final decade.", src: "Compound interest math" },
  { id: "es39", topic: "money", q: "With 3% yearly inflation, how many years until prices double?", answer: 23.4, unit: "years", min: 1, max: 200, log: true, explain: "Rule of 72 again: 72 / 3 = 24. Cash under a mattress loses half its value in that time.", src: "Compound interest math" },
  { id: "es40", topic: "money", q: "How tall is a stack of one million US $1 bills?", answer: 109, unit: "m", min: 1, max: 10000, log: true, explain: "Taller than the Statue of Liberty. Each bill is about 0.11 mm thick.", src: "US Bureau of Engraving and Printing" },
  { id: "es41", topic: "money", q: "Spending $1 every second, how many years would it take to spend $1 billion?", answer: 31.7, unit: "years", min: 0.1, max: 10000, log: true, explain: "A million dollars at that pace is gone in under 12 days.", src: "Arithmetic" },
  { id: "es42", topic: "money", q: "An investment drops 50%, then gains 50%. What % of the original is left?", answer: 75, unit: "%", min: 0, max: 200, log: false, explain: "Losses hurt more than equal gains help: after a 50% drop you need +100% to recover.", src: "Arithmetic" },

  // ---------- mind (6) ----------
  { id: "es43", topic: "mind", q: "How many people must be in a room for a 50% chance two share a birthday?", answer: 23, unit: "people", min: 2, max: 366, log: true, explain: "With 23 people there are 253 possible pairs, which adds up fast.", src: "Probability theory" },
  { id: "es44", topic: "mind", q: "How many times would you fold 0.1 mm paper (in theory) to reach the Moon?", answer: 42, unit: "folds", min: 1, max: 1000, log: true, explain: "Each fold doubles the thickness. Doubling beats intuition every time.", src: "Arithmetic" },
  { id: "es45", topic: "mind", q: "Double rice grains on each chessboard square (1, 2, 4...). How many in total?", answer: 1.8e19, unit: "grains", min: 1000, max: 1e30, log: true, explain: "Hundreds of times the world's yearly rice harvest.", src: "Arithmetic" },
  { id: "es46", topic: "mind", q: "In the Monty Hall problem, what's your chance of winning if you switch doors?", answer: 66.7, unit: "%", min: 0, max: 100, log: false, explain: "Two-thirds, not 50%. The host's choice gives you information.", src: "Probability theory" },
  { id: "es47", topic: "mind", q: "About how many days are there in an 80-year life?", answer: 29220, unit: "days", min: 1000, max: 1000000, log: true, explain: "Under 30,000. Each one is worth noticing.", src: "Arithmetic" },
  { id: "es48", topic: "mind", q: "How many different orders can a deck of 52 cards be shuffled into?", answer: 8.07e67, unit: "orders", min: 1e10, max: 1e100, log: true, explain: "Any well-shuffled deck is almost certainly in an order never seen before.", src: "Combinatorics" },

  // ---------- tech (6) ----------
  { id: "es49", topic: "tech", q: "Moore's law: transistor counts on chips double about every how many years?", answer: 2, unit: "years", min: 0.1, max: 20, log: true, explain: "Gordon Moore revised his forecast to every two years in 1975.", src: "Intel" },
  { id: "es50", topic: "tech", q: "How many kilobytes of RAM did the Apollo Guidance Computer have?", answer: 4, unit: "KB", min: 0.01, max: 10000, log: true, explain: "About 2,048 words of erasable memory. A phone today has millions of times more.", src: "NASA" },
  { id: "es51", topic: "tech", q: "How fast do light signals travel in optical fiber, in km per second?", answer: 200000, unit: "km/s", min: 1000, max: 10000000, log: true, explain: "About two-thirds of light's speed in a vacuum, because glass slows it down.", src: "Physics" },
  { id: "es52", topic: "tech", q: "How much did ENIAC, an early general-purpose computer (1945), weigh?", answer: 27, unit: "tonnes", min: 0.1, max: 1000, log: true, explain: "About as heavy as four elephants, and it filled a large room.", src: "Britannica" },
  { id: "es53", topic: "tech", q: "At what altitude do GPS satellites orbit Earth?", answer: 20200, unit: "km", min: 100, max: 1000000, log: true, explain: "About 50 times higher than the ISS.", src: "GPS.gov" },
  { id: "es54", topic: "tech", q: "In what year was the first email sent between two computers on a network?", answer: 1971, unit: "", min: 1900, max: 2010, log: false, explain: "Ray Tomlinson sent it on ARPANET and picked @ to separate user from host.", src: "Britannica" },

  // ---------- culture (6) ----------
  { id: "es55", topic: "culture", q: "How many keys are on a standard modern piano?", answer: 88, unit: "keys", min: 10, max: 500, log: true, explain: "52 white and 36 black, spanning just over seven octaves.", src: "Britannica" },
  { id: "es56", topic: "culture", q: "How tall is the Mona Lisa painting?", answer: 77, unit: "cm", min: 10, max: 1000, log: true, explain: "Smaller than most people expect: about the size of a poster.", src: "Louvre" },
  { id: "es57", topic: "culture", q: "About how many languages are spoken in the world today?", answer: 7000, unit: "languages", min: 100, max: 1000000, log: true, explain: "About 40% of them are endangered, many with under 1,000 speakers.", src: "Ethnologue" },
  { id: "es58", topic: "culture", q: "How tall is the Statue of Liberty from the ground to the tip of its torch?", answer: 93, unit: "m", min: 5, max: 1000, log: true, explain: "Including its pedestal. The copper statue alone is about 46 m.", src: "US National Park Service" },
  { id: "es59", topic: "culture", q: "What % of letters in typical English text is the letter E?", answer: 12.7, unit: "%", min: 0, max: 50, log: false, explain: "About one letter in eight. Codebreakers have used this for centuries.", src: "Cryptography literature" },
  { id: "es60", topic: "culture", q: "How long is an official marathon?", answer: 42.195, unit: "km", min: 1, max: 1000, log: true, explain: "The odd distance comes from the 1908 London Olympics route, made standard in 1921.", src: "World Athletics" }
);
