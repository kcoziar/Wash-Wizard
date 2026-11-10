import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as SMS from 'expo-sms';
import { reportError } from './analytics';
import { quoteFileName, quoteSmsMessage, quoteTitle, renderQuoteHtml, renderQuoteText } from './document';
export { smsAddress } from './format';
import { MAX_BACKUP_CHARS } from './storage';
import type { QuoteDoc } from './types';

/** Page margins in points, applied by iOS on every page (CSS page margins are not honored there). */
const PDF_MARGINS = { top: 40, bottom: 40, left: 44, right: 44 };

/** Prepares the customer PDF in the cache folder and checks it is a real, non-empty file. */
export async function preparePdf(doc: QuoteDoc): Promise<{ ok: true; uri: string } | { ok: false; error: string }> {
  if (Platform.OS === 'web') return { ok: false, error: 'PDF files are made on iPhone. In this preview you can print, copy or share the text.' };
  try {
    const { uri } = await Print.printToFileAsync({ html: renderQuoteHtml(doc), width: 612, height: 792, margins: PDF_MARGINS });
    const tmp = new File(uri);
    if (!tmp.exists || tmp.size < 800) return { ok: false, error: 'The PDF came out empty. You can still share the quote as text.' };
    const dir = new Directory(Paths.cache, 'quotes');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, quoteFileName(doc));
    if (target.exists) target.delete();
    await tmp.move(target, { overwrite: true });
    return { ok: true, uri: target.uri };
  } catch (e) {
    reportError(e, 'pdf');
    return { ok: false, error: 'The PDF could not be made on this device. You can still share the quote as text.' };
  }
}

export type ShareResult = 'opened' | 'closed' | 'failed';

export async function sharePdf(doc: QuoteDoc, uri?: string): Promise<ShareResult> {
  try {
    let fileUri = uri;
    if (!fileUri || !new File(fileUri).exists) {
      const made = await preparePdf(doc);
      if (!made.ok) return 'failed';
      fileUri = made.uri;
    }
    if (!(await Sharing.isAvailableAsync())) return 'failed';
    await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: quoteTitle(doc) });
    return 'closed';
  } catch (e) {
    reportError(e, 'share');
    return 'failed';
  }
}

/** This build can text a quote with Messages (shown on the paywall only because it ships). */
export const TEXT_SEND_AVAILABLE = true;

/** True when this iPhone can open the Messages composer. Always false on web and in the simulator. */
export async function canText(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SMS.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Opens Messages with the customer's number, a short editable message and the PDF attached.
 * 'sent' means the operator pressed Send in the composer. It does not mean the message was delivered.
 */
export async function textQuote(phone: string, doc: QuoteDoc, pdfUri: string | null): Promise<'sent' | 'cancelled' | 'unknown' | 'failed'> {
  try {
    let attach = pdfUri;
    if (!attach || !new File(attach).exists) {
      const made = await preparePdf(doc);
      attach = made.ok ? made.uri : null;
    }
    // Without the PDF the whole quote goes in the message, so the customer still gets every line.
    const options = attach ? { attachments: { uri: attach, mimeType: 'application/pdf', filename: quoteFileName(doc) } } : undefined;
    const { result } = await SMS.sendSMSAsync([phone], attach ? quoteSmsMessage(doc) : renderQuoteText(doc), options);
    return result;
  } catch (e) {
    reportError(e, 'share');
    return 'failed';
  }
}

export async function shareText(doc: QuoteDoc): Promise<ShareResult> {
  try {
    const res = await Share.share({ message: renderQuoteText(doc), title: quoteTitle(doc) });
    return res.action === Share.sharedAction ? 'opened' : 'closed';
  } catch {
    return 'failed';
  }
}

export async function copyText(doc: QuoteDoc): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(renderQuoteText(doc));
    return true;
  } catch {
    return false;
  }
}

export async function printDoc(doc: QuoteDoc): Promise<boolean> {
  try {
    await Print.printAsync({ html: renderQuoteHtml(doc), margins: PDF_MARGINS });
    return true;
  } catch {
    return false;
  }
}

/** Lets the operator pick one image (system picker, no library permission) and returns a small square data URI. */
export async function pickLogo(): Promise<{ ok: true; dataUri: string } | { ok: false; cancelled: boolean; error?: string }> {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (res.canceled || !res.assets?.[0]) return { ok: false, cancelled: true };
    const ctx = ImageManipulator.manipulate(res.assets[0].uri);
    ctx.resize({ width: 256, height: 256 });
    const img = await ctx.renderAsync();
    const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    if (!saved.base64) return { ok: false, cancelled: false, error: 'That image could not be read.' };
    return { ok: true, dataUri: `data:image/jpeg;base64,${saved.base64}` };
  } catch {
    return { ok: false, cancelled: false, error: 'That image could not be used. Try a PNG or JPEG.' };
  }
}

export async function exportBackupFile(json: string, name: string): Promise<'shared' | 'downloaded' | 'failed'> {
  try {
    if (Platform.OS === 'web') {
      const g = globalThis as unknown as { document?: { createElement: (t: string) => { href: string; download: string; click: () => void } }; URL?: { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void } };
      if (!g.document || !g.URL) return 'failed';
      const url = g.URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = g.document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => g.URL?.revokeObjectURL(url), 2000);
      return 'downloaded';
    }
    const dir = new Directory(Paths.cache, 'backups');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, name);
    if (file.exists) file.delete();
    file.create();
    await file.write(json);
    if (!(await Sharing.isAvailableAsync())) return 'failed';
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save backup' });
    return 'shared';
  } catch {
    return 'failed';
  }
}

export async function pickBackupText(): Promise<{ ok: true; text: string; name: string } | { ok: false; cancelled: boolean; error?: string }> {
  try {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.[0]) return { ok: false, cancelled: true };
    const asset = res.assets[0];
    if (asset.size != null && asset.size > MAX_BACKUP_CHARS) return { ok: false, cancelled: false, error: 'That file is too large to be a backup from this app.' };
    let text: string;
    if (Platform.OS === 'web') {
      const file = (asset as unknown as { file?: Blob }).file;
      text = file ? await file.text() : await (await fetch(asset.uri)).text();
    } else {
      const copy = new File(asset.uri);
      text = await copy.text();
      // The picker made a private copy; it holds customer data, so remove it once read.
      try {
        if (copy.exists) copy.delete();
      } catch {
        // Cleared with the other temporary files later.
      }
    }
    return { ok: true, text, name: asset.name };
  } catch {
    return { ok: false, cancelled: false, error: 'That file could not be opened.' };
  }
}

/** Folders where the app leaves temporary copies of quotes, backups and picked images. */
const TEMP_FOLDERS = ['quotes', 'backups', 'Print', 'DocumentPicker', 'ImagePicker', 'ImageManipulator'];

/** Deletes temporary files that may contain customer details. Returns false if any could not be removed. */
export function clearAppCaches(): boolean {
  if (Platform.OS === 'web') return true;
  let ok = true;
  for (const name of TEMP_FOLDERS) {
    try {
      const dir = new Directory(Paths.cache, name);
      if (dir.exists) dir.delete();
    } catch {
      ok = false;
    }
  }
  return ok;
}
