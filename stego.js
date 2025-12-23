/* ====== SECURITY ====== */
function hashPassword(pwd) {
  let hash = 0;
  for (let i = 0; i < pwd.length; i++) {
    hash = (hash << 5) - hash + pwd.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function encryptMessage(msg, pwd) {
  if (!pwd) return msg;
  const hash = hashPassword(pwd);
  let encrypted = "";
  for (let i = 0; i < msg.length; i++) {
    encrypted += String.fromCharCode(
      msg.charCodeAt(i) ^ (hash % 256)
    );
  }
  return btoa(encrypted);
}

function decryptMessage(encrypted, pwd) {
  if (!pwd) return encrypted;
  try {
    const decoded = atob(encrypted);
    const hash = hashPassword(pwd);
    let decrypted = "";
    for (let i = 0; i < decoded.length; i++) {
      decrypted += String.fromCharCode(
        decoded.charCodeAt(i) ^ (hash % 256)
      );
    }
    return decrypted;
  } catch {
    return null;
  }
}

/* ====== IMAGE (LSB) ====== */
function encodeMessageToImage(file, message, password) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = e => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        const finalMessage = password
          ? encryptMessage(message, password)
          : message;

        const msg = finalMessage + "###END###";

        let binary = "";
        for (let c of msg) {
          binary += c.charCodeAt(0).toString(2).padStart(8, "0");
        }

        if (binary.length > data.length / 4) {
          reject("Gambar terlalu kecil");
          return;
        }

        for (let i = 0; i < binary.length; i++) {
          data[i * 4] = (data[i * 4] & 0xfe) | parseInt(binary[i]);
        }

        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob(blob => resolve(blob), "image/png");
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function decodeMessageFromImage(file, password) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = e => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let binary = "";

        for (let i = 0; i < data.length / 4; i++) {
          binary += (data[i * 4] & 1);
        }

        let message = "";
        for (let i = 0; i < binary.length; i += 8) {
          const char = parseInt(binary.substr(i, 8), 2);
          if (!char) break;
          message += String.fromCharCode(char);
        }

        const end = message.indexOf("###END###");
        if (end === -1) reject("Pesan tidak ditemukan");

        let extracted = message.substring(0, end);
        if (password) {
          extracted = decryptMessage(extracted, password);
          if (!extracted) reject("Password salah");
        }
        resolve(extracted);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ====== BINARY FILE ====== */
function encodeMessageToBinary(file, message, password) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      const bytes = new Uint8Array(e.target.result);

      const finalMessage = password
        ? encryptMessage(message, password)
        : message;

      const msgBytes = new TextEncoder().encode(
        finalMessage + "###END###"
      );

      const output = new Uint8Array(4 + msgBytes.length + bytes.length);
      new DataView(output.buffer).setUint32(0, msgBytes.length, true);
      output.set(msgBytes, 4);
      output.set(bytes, 4 + msgBytes.length);

      resolve(new Blob([output], { type: file.type }));
    };
    reader.readAsArrayBuffer(file);
  });
}

function decodeMessageFromBinary(file, password) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const bytes = new Uint8Array(e.target.result);
      const len = new DataView(bytes.buffer).getUint32(0, true);

      const msg = new TextDecoder().decode(
        bytes.slice(4, 4 + len)
      );

      const end = msg.indexOf("###END###");
      if (end === -1) reject("Pesan tidak ditemukan");

      let extracted = msg.substring(0, end);
      if (password) {
        extracted = decryptMessage(extracted, password);
        if (!extracted) reject("Password salah");
      }
      resolve(extracted);
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ====== SIDECAR STEGANOGRAPHY ====== */

async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function encodeSidecar(file, message, password) {
  const fileHash = await hashFile(file);

  const encrypted = password
    ? encryptMessage(message, password)
    : message;

  const sidecar = {
    version: "1.0",
    originalFile: file.name,
    originalHash: fileHash,
    timestamp: new Date().toISOString(),
    payload: encrypted
  };

  return new Blob(
    [JSON.stringify(sidecar, null, 2)],
    { type: "application/json" }
  );
}

async function decodeSidecar(originalFile, stegoFile, password) {
  const expectedHash = await hashFile(originalFile);
  const stegoText = await stegoFile.text();
  const data = JSON.parse(stegoText);

  if (data.originalHash !== expectedHash) {
    throw "File asli tidak cocok dengan file stego";
  }

  let message = data.payload;

  if (password) {
    message = decryptMessage(message, password);
    if (!message) throw "Password salah";
  }

  return message;
}
