#!/usr/bin/env python3
# Writes shared/emojiNames.js: what an emoji is called when a voice says it, from Unicode's own names (by the Python
# running this), lowercased and trimmed of their color and weight words, with the names kids hear most set by hand.
# Run it again to take in a newer Unicode: python3 scripts/emojiNames.py
import json
import re
import unicodedata

RANGES = [(0x2600, 0x27BF), (0x2B00, 0x2BFF), (0x1F000, 0x1F02F), (0x1F0A0, 0x1F0FF), (0x1F300, 0x1FAFF)]
DROP = re.compile(r'^(white|black|heavy|medium|large|small|hollow)( (white|black|heavy|medium|large|small|hollow))*\s+(?=\w+( \w+)*$)')
ANIMALS = ['zebra', 'frog', 'dog', 'cat', 'lion', 'tiger', 'cow', 'pig', 'monkey', 'horse', 'mouse', 'hamster', 'rabbit',
           'bear', 'panda', 'koala', 'wolf', 'fox', 'unicorn', 'dragon', 'chicken', 'bird', 'polar bear']
BY_HAND = {
    '🔁': 'repeat', '🔄': 'again', '🔀': 'shuffle', '➡': 'right', '⬅': 'left', '⬆': 'up', '⬇': 'down', '▶': 'play',
    '⏸': 'pause', '⏹': 'stop', '⏩': 'fast forward', '💥': 'boom', '🌊': 'wave', '💫': 'dizzy', '💤': 'sleepy',
    '💬': 'speech bubble', '📣': 'megaphone', '🔔': 'bell', '🔑': 'key', '🔒': 'lock', '🔓': 'unlocked', '🧭': 'compass',
    '🗺': 'map', '⏰': 'alarm clock', '⏳': 'hourglass', '🧮': 'abacus', '✏': 'pencil', '📝': 'notes', '🖍': 'crayon',
    '🪣': 'bucket', '🏖': 'beach', '🏜': 'desert', '🏔': 'mountain', '🌋': 'volcano', '🪐': 'planet', '🌍': 'earth',
    '🌎': 'earth', '🌏': 'earth', '🛰': 'satellite', '👨‍🚀': 'astronaut', '👩‍🚀': 'astronaut', '🧑‍🚀': 'astronaut',
    '⭐': 'star', '🌟': 'star', '✨': 'sparkles', '🚀': 'rocket', '🐸': 'frog', '👀': 'eyes', '💡': 'idea',
    '❤': 'heart', '💖': 'heart', '👍': 'thumbs up', '👎': 'thumbs down', '🎉': 'party', '🏁': 'finish flag',
    '🎮': 'game', '🕹': 'joystick', '↩': 'back', '✖': 'no', '✅': 'yes', '❌': 'no', '🐶': 'puppy', '🐱': 'kitty',
    '🦊': 'fox', '🐼': 'panda', '🦄': 'unicorn', '🐙': 'octopus', '🐯': 'tiger', '🐧': 'penguin', '🐝': 'bee',
    '🐉': 'dragon', '🐲': 'dragon', '🚒': 'fire truck', '🚗': 'car', '🚂': 'train', '✈': 'airplane', '🛸': 'spaceship',
    '🌙': 'moon', '🌈': 'rainbow', '☀': 'sun', '🌧': 'rain', '⚡': 'lightning', '🔥': 'fire', '💧': 'water',
    '🍎': 'apple', '🍕': 'pizza', '🍪': 'cookie', '🎁': 'present', '🎈': 'balloon', '🏆': 'trophy', '🥇': 'gold medal',
    '👾': 'alien', '👽': 'alien', '🤖': 'robot', '👻': 'ghost', '🧙': 'wizard', '🧚': 'fairy', '🦖': 'dinosaur',
    '🦕': 'dinosaur', '🐢': 'turtle', '🐟': 'fish', '🐠': 'fish', '🦋': 'butterfly', '🐌': 'snail', '🌸': 'flower',
    '🌻': 'sunflower', '🌳': 'tree', '🏠': 'home', '🏰': 'castle', '🧩': 'puzzle piece', '🎨': 'paints', '🎵': 'music',
    '🔊': 'sound', '🎯': 'target', '🪄': 'magic wand', '💎': 'gem', '🪙': 'coin', '🧲': 'magnet', '🪨': 'rock',
    '🪷': 'lily pad', '🪰': 'fly', '😀': 'happy face', '😃': 'happy face', '😊': 'smile', '😂': 'laughing',
    '🤔': 'thinking', '😮': 'surprised', '😢': 'sad', '👋': 'wave', '🙌': 'hooray', '👏': 'clap', '🫧': 'bubbles',
}

names = {}
for start, end in RANGES:
    for code in range(start, end + 1):
        char = chr(code)
        try:
            name = unicodedata.name(char).lower()
        except ValueError:
            continue
        if unicodedata.category(char) not in ('So', 'Sm', 'Po'):
            continue
        name = DROP.sub('', name)
        name = re.sub(r'\s+(sign|symbol|button)$', '', name)
        # Said aloud, not read: what follows "with" is detail, and two words name a thing
        name = re.sub(r'\s+with\s.*$', '', name)
        name = ' '.join(name.split()[:2])
        # An animal's face is the animal
        name = re.sub(r'^(' + '|'.join(ANIMALS) + r') face$', r'\1', name)
        names[char] = name
names.update(BY_HAND)

lines = ['// What an emoji is called when a voice says it. Made by scripts/emojiNames.py from Unicode\'s names: do not',
         '// edit by hand; add to the script\'s BY_HAND and run it again.',
         'const EMOJI_NAMES = ' + json.dumps(names, ensure_ascii=False, indent='\t', sort_keys=True) + ';',
         '',
         'export default EMOJI_NAMES;',
         '']
open('shared/emojiNames.js', 'w').write('\n'.join(lines))
print(len(names), 'names;', unicodedata.unidata_version)
for sample in ['🚀', '🐸', '⭐', '🎸', '🧀', '🦓', '☂', '🪁', '🛝', '🫠']:
    print(' ', sample, names.get(sample))
