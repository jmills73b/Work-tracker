import { json } from '../../lib/http.js';

export function onRequestGet({ data }) {
  return json({ email: data.user });
}
