/**
 * Minimal self-contained LZ-String UTF16 decompressor matching MWI localStorage.initClientData.
 */
export function decompressFromUTF16(input: string | null | undefined): string | null {
  if (input == null) return "";
  if (input === "") return null;
  return _decompress(input.length, 16384, (index) => input.charCodeAt(index) - 32);
}

function _decompress(
  length: number,
  resetValue: number,
  getNextValue: (index: number) => number
): string | null {
  const dictionary: Array<string | number> = [0, 1, 2];
  const result: string[] = [];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry = "";
  let c: string | number;
  let bits = 0;
  let maxpower = 4;
  let power = 1;

  const data = {
    val: getNextValue(0),
    position: resetValue,
    index: 1,
  };

  while (power !== maxpower) {
    const resb = data.val & data.position;
    data.position >>= 1;
    if (data.position === 0) {
      data.position = resetValue;
      data.val = getNextValue(data.index++);
    }
    bits |= (resb > 0 ? 1 : 0) * power;
    power <<= 1;
  }

  const next = bits;
  switch (next) {
    case 0:
      bits = 0;
      maxpower = 256;
      power = 1;
      while (power !== maxpower) {
        const resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      c = String.fromCharCode(bits);
      break;
    case 1:
      bits = 0;
      maxpower = 65536;
      power = 1;
      while (power !== maxpower) {
        const resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      c = String.fromCharCode(bits);
      break;
    case 2:
      return "";
    default:
      return null;
  }

  dictionary[3] = c;
  let w = c;
  result.push(c);

  while (true) {
    if (data.index > length) return "";
    bits = 0;
    maxpower = Math.pow(2, numBits);
    power = 1;
    while (power !== maxpower) {
      const resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }

    let cc: string | number = bits;
    switch (cc) {
      case 0:
        bits = 0;
        maxpower = 256;
        power = 1;
        while (power !== maxpower) {
          const resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        dictionary[dictSize++] = String.fromCharCode(bits);
        cc = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        bits = 0;
        maxpower = 65536;
        power = 1;
        while (power !== maxpower) {
          const resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        dictionary[dictSize++] = String.fromCharCode(bits);
        cc = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join("");
    }

    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }

    if (dictionary[cc as number] !== undefined) {
      entry = String(dictionary[cc as number]);
    } else if (cc === dictSize) {
      entry = w + w.charAt(0);
    } else {
      return null;
    }

    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;

    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  }
}
