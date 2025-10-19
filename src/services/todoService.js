// src/services/todoService.js
import {
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';

/**
 * 유저의 모든 할 일 목록을 마감일 순으로 불러옵니다.
 * @param {string} userId
 * @returns {Promise<Array<{ id: string, text: string, dueDate: string }>>}
 */
export async function loadTodos(userId) {
  const todosRef = collection(db, 'users', userId, 'todos');
  const q = query(todosRef, orderBy('dueDate', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * 새 할 일을 추가합니다.
 * @param {string} userId
 * @param {{ text: string, dueDate: string }} todo
 * @returns {Promise<string>} 생성된 문서 ID
 */
export async function addTodo(userId, todo) {
  const todosRef = collection(db, 'users', userId, 'todos');
  const docRef = await addDoc(todosRef, todo);
  return docRef.id;
}

/**
 * 특정 할 일 하나를 불러옵니다.
 * @param {string} userId
 * @param {string} todoId
 * @returns {Promise<{ id: string, text: string, dueDate: string } | null>}
 */
export async function loadTodo(userId, todoId) {
  const todoRef = doc(db, 'users', userId, 'todos', todoId);
  const snap = await getDoc(todoRef);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * 기존 할 일을 업데이트합니다.
 * @param {string} userId
 * @param {string} todoId
 * @param {{ text: string, dueDate: string }} updates
 */
export async function updateTodo(userId, todoId, updates) {
  const todoRef = doc(db, 'users', userId, 'todos', todoId);
  await updateDoc(todoRef, updates);
}

/**
 * 특정 할 일을 삭제합니다.
 * @param {string} userId
 * @param {string} todoId
 */
export async function deleteTodo(userId, todoId) {
  const todoRef = doc(db, 'users', userId, 'todos', todoId);
  await deleteDoc(todoRef);
}
