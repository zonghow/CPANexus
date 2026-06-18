export const accountTagMaxLength = 48;

export type AccountTagIdentity = {
  email: string | null;
  fileName: string;
};

export function accountTagKey(account: AccountTagIdentity) {
  const email = account.email?.trim().toLowerCase();
  if (email) {
    return `email:${email}`;
  }

  return accountTagFileKey(account);
}

export function accountTagLookupKeys(account: AccountTagIdentity) {
  const fileKey = accountTagFileKey(account);
  const email = account.email?.trim().toLowerCase();
  return email ? [`email:${email}`, fileKey] : [fileKey];
}

export function normalizeAccountTag(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, accountTagMaxLength) : null;
}

function accountTagFileKey(account: AccountTagIdentity) {
  return `file:${account.fileName.trim().toLowerCase()}`;
}
