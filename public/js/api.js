const API = (() => {
  const BASE = '/api';

  function getToken() { return localStorage.getItem('hw_token'); }
  function getUser()  { const u = localStorage.getItem('hw_user'); return u ? JSON.parse(u) : null; }

  function setAuth(token, user) {
    localStorage.setItem('hw_token', token);
    localStorage.setItem('hw_user', JSON.stringify(user));
  }

  function clearAuth() {
    localStorage.removeItem('hw_token');
    localStorage.removeItem('hw_user');
  }

  async function req(path, opts = {}) {
    const token = getToken();
    const res = await fetch(BASE + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { clearAuth(); location.href = '/'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  return {
    getUser, setAuth, clearAuth,
    login:           (username, password) => req('/auth/login', { method: 'POST', body: { username, password } }),
    getStudents:     (class_year) => req('/users/students' + (class_year ? `?class_year=${encodeURIComponent(class_year)}` : '')),
    createStudent:   (data) => req('/users/students', { method: 'POST', body: data }),
    updateStudent:   (id, data) => req(`/users/students/${id}`, { method: 'PUT', body: data }),
    deleteStudent:   (id) => req(`/users/students/${id}`, { method: 'DELETE' }),
    getClassYears:   () => req('/users/class-years'),
    getTopics:       () => req('/topics'),
    createTopic:     (data) => req('/topics', { method: 'POST', body: data }),
    deleteTopic:     (id) => req(`/topics/${id}`, { method: 'DELETE' }),
    getAssignments:  (filters = {}) => {
      const p = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))).toString();
      return req('/assignments' + (p ? `?${p}` : ''));
    },
    createAssignment: (data) => req('/assignments', { method: 'POST', body: data }),
    updateAssignment: (id, data) => req(`/assignments/${id}`, { method: 'PUT', body: data }),
    deleteAssignment: (id) => req(`/assignments/${id}`, { method: 'DELETE' }),
    completeAssignment: (id, data) => req(`/assignments/${id}/complete`, { method: 'PUT', body: data }),
    uploadFiles: (id, formData) => {
      const token = getToken();
      return fetch(`${BASE}/assignments/${id}/files`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      }).then(r => r.json());
    },
    deleteFile: (assignmentId, fileId) => req(`/assignments/${assignmentId}/files/${fileId}`, { method: 'DELETE' }),
    getAssignmentStudents: (id) => req(`/assignments/${id}/students`),
    gradeStudent: (assignmentId, studentId, data) => req(`/assignments/${assignmentId}/grade/${studentId}`, { method: 'PUT', body: data }),
  };
})();
