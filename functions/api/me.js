import { json } from '../../lib/http.js';

export function onRequestGet({ data }) {
  return json({ username: data.username });
}
