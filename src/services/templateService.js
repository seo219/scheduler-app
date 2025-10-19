import { db } from '../firebaseConfig';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  deleteDoc,
} from 'firebase/firestore';

export async function loadTemplate(userId, id) {
  const ref = doc(db, 'users', userId, 'templates', id);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function saveTemplate(userId, data, id = null) {
  if (id) {
    const ref = doc(db, 'users', userId, 'templates', id);
    await setDoc(ref, data, { merge: true });
  } else {
    const ref = collection(db, 'users', userId, 'templates');
    await addDoc(ref, data);
  }
}

export async function deleteTemplate(userId, templateId) {
  const ref = doc(db, 'users', userId, 'templates', templateId);
  await deleteDoc(ref);
}