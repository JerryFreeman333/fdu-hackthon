export const ROLE_SURFACES = Object.freeze({
  resident: Object.freeze(['home', 'find']),
  family: Object.freeze(['family-home', 'family-hazards', 'family-paths']),
});

export function surfacesForRole(role) {
  if (!(role in ROLE_SURFACES)) throw new Error(`unknown role: ${role}`);
  return [...ROLE_SURFACES[role]];
}
