const APP_KEYS = {
  token: "placement_tracker_token",
  theme: "placement_tracker_theme"
};
const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";

const TOPICS = [
  "Arrays",
  "Strings",
  "Linked List",
  "Dynamic Programming",
  "Graphs"
];

function getPage() {
  return document.body.dataset.page || "";
}

function getToken() {
  return localStorage.getItem(APP_KEYS.token) || "";
}

function setToken(token) {
  localStorage.setItem(APP_KEYS.token, token);
}

function clearToken() {
  localStorage.removeItem(APP_KEYS.token);
}

async function apiRequest(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });
  } catch {
    const error = new Error(
      "Backend not reachable. Please try again later."
    );
    error.status = 0;
    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = response.status;
    throw error;
  }

  return data;
}

function redirect(path) {
  window.location.href = path;
}

function setError(message) {
  const errorNode = document.getElementById("error");
  if (errorNode) {
    errorNode.textContent = message;
  }
}

function applyTheme() {
  const theme = localStorage.getItem(APP_KEYS.theme) || "light";
  document.body.classList.toggle("dark", theme === "dark");
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem(APP_KEYS.theme, isDark ? "dark" : "light");
}

function formatDate(isoValue) {
  return new Date(isoValue).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}

async function getCurrentUser() {
  try {
    const data = await apiRequest("/api/auth/me");
    return data.user;
  } catch {
    return null;
  }
}

async function requireAuth() {
  const token = getToken();
  if (!token) {
    redirect("login.html");
    return null;
  }

  const user = await getCurrentUser();
  if (!user) {
    clearToken();
    redirect("login.html");
    return null;
  }

  return user;
}

async function requireGuest() {
  const token = getToken();
  if (!token) {
    return;
  }

  const user = await getCurrentUser();
  if (user) {
    redirect("index.html");
    return;
  }

  clearToken();
}

function getDifficultyCounts(problems) {
  return problems.reduce(
    (acc, item) => {
      if (item.difficulty === "Easy") acc.easy += 1;
      if (item.difficulty === "Medium") acc.medium += 1;
      if (item.difficulty === "Hard") acc.hard += 1;
      return acc;
    },
    { easy: 0, medium: 0, hard: 0 }
  );
}

function getTopicCounts(problems) {
  const base = Object.fromEntries(TOPICS.map((topic) => [topic, 0]));
  for (const problem of problems) {
    if (!base[problem.topic] && problem.topic) {
      base[problem.topic] = 0;
    }
    base[problem.topic] += 1;
  }
  return base;
}

function initAuthPages(page) {
  if (page === "login") {
    const form = document.getElementById("loginForm");

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      setError("");

      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value;

      try {
        const data = await apiRequest("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });

        setToken(data.token);
        redirect("index.html");
      } catch (error) {
        setError(error.message);
      }
    });
  }

  if (page === "signup") {
    const form = document.getElementById("signupForm");

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      setError("");

      const username = document.getElementById("newUser").value.trim();
      const password = document.getElementById("newPass").value;

      try {
        const data = await apiRequest("/api/auth/signup", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });

        // Auto-login after signup via issued token.
        setToken(data.token);
        redirect("index.html");
      } catch (error) {
        setError(error.message);
      }
    });
  }
}

async function initDashboard() {
  const user = await requireAuth();
  if (!user) {
    return;
  }

  const currentUserNode = document.getElementById("currentUser");
  if (currentUserNode) {
    currentUserNode.textContent = user.username || "-";
  }

  const form = document.getElementById("problemForm");
  const table = document.getElementById("problemTable");
  const themeBtn = document.getElementById("themeBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const searchInput = document.getElementById("searchInput");
  const filterDifficulty = document.getElementById("filterDifficulty");
  const filterStatus = document.getElementById("filterStatus");
  const exportBtn = document.getElementById("exportBtn");
  const clearAllBtn = document.getElementById("clearAllBtn");
  const topicSelectMain = document.getElementById("topic");
  const customTopicWrap = document.getElementById("customTopicWrap");
  const customTopicInput = document.getElementById("customTopic");

  const statTotal = document.getElementById("statTotal");
  const statSolved = document.getElementById("statSolved");
  const statAttempted = document.getElementById("statAttempted");
  const statHard = document.getElementById("statHard");
  const progressLabel = document.getElementById("progressLabel");
  const progressFill = document.getElementById("progressFill");

  const difficultyCanvas = document.getElementById("difficultyChart");
  const topicCanvas = document.getElementById("topicChart");

  let problems = [];
  let difficultyChart = null;
  let topicChart = null;

  async function fetchProblems() {
    try {
      const data = await apiRequest("/api/problems");
      problems = Array.isArray(data.problems) ? data.problems : [];
    } catch (error) {
      if (error.status === 401) {
        clearToken();
        redirect("login.html");
        return;
      }
      throw error;
    }
  }

  function getFilteredProblems() {
    const text = (searchInput?.value || "").trim().toLowerCase();
    const selectedDifficulty = filterDifficulty?.value || "All";
    const selectedStatus = filterStatus?.value || "All";

    return problems.filter((problem) => {
      const byName = !text || problem.name.toLowerCase().includes(text);
      const byDifficulty =
        selectedDifficulty === "All" || problem.difficulty === selectedDifficulty;
      const byStatus = selectedStatus === "All" || problem.status === selectedStatus;
      return byName && byDifficulty && byStatus;
    });
  }

  function renderStats() {
    const total = problems.length;
    const solved = problems.filter((item) => item.status === "Solved").length;
    const attempted = problems.filter((item) => item.status === "Attempted").length;
    const hard = problems.filter((item) => item.difficulty === "Hard").length;
    const solvedPercent = total ? Math.round((solved / total) * 100) : 0;

    statTotal.textContent = String(total);
    statSolved.textContent = String(solved);
    statAttempted.textContent = String(attempted);
    statHard.textContent = String(hard);
    progressLabel.textContent = `${solvedPercent}%`;
    progressFill.style.width = `${solvedPercent}%`;
  }

  function renderEditableRow(row, problem) {
    row.innerHTML = "";

    const nameCell = row.insertCell(0);
    const topicCell = row.insertCell(1);
    const difficultyCell = row.insertCell(2);
    const statusCell = row.insertCell(3);
    const platformCell = row.insertCell(4);
    const createdCell = row.insertCell(5);
    const actionCell = row.insertCell(6);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = problem.name;

    const topicSelect = document.createElement("select");
    [...TOPICS, "Other", problem.topic]
      .filter(Boolean)
      .filter((value, idx, arr) => arr.indexOf(value) === idx)
      .forEach((topic) => {
        const option = document.createElement("option");
        option.value = topic;
        option.textContent = topic;
        if (topic === problem.topic) {
          option.selected = true;
        }
        topicSelect.appendChild(option);
      });

    const difficultySelect = document.createElement("select");
    ["Easy", "Medium", "Hard"].forEach((difficulty) => {
      const option = document.createElement("option");
      option.value = difficulty;
      option.textContent = difficulty;
      if (difficulty === problem.difficulty) {
        option.selected = true;
      }
      difficultySelect.appendChild(option);
    });

    const statusSelect = document.createElement("select");
    ["Solved", "Attempted", "Revision"].forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      if (status === problem.status) {
        option.selected = true;
      }
      statusSelect.appendChild(option);
    });

    const platformInput = document.createElement("input");
    platformInput.type = "text";
    platformInput.value = problem.platform === "-" ? "" : problem.platform;

    nameCell.appendChild(nameInput);
    topicCell.appendChild(topicSelect);
    difficultyCell.appendChild(difficultySelect);
    statusCell.appendChild(statusSelect);
    platformCell.appendChild(platformInput);
    createdCell.textContent = formatDate(problem.createdAt);

    actionCell.className = "actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-small";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-secondary btn-small";
    cancelBtn.textContent = "Cancel";

    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }

      let selectedTopic = topicSelect.value;
      if (selectedTopic === "Other") {
        const other = window.prompt("Enter custom topic:", "");
        if (!other || !other.trim()) {
          return;
        }
        selectedTopic = other.trim();
      }

      try {
        const data = await apiRequest(`/api/problems/${problem.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name,
            topic: selectedTopic,
            difficulty: difficultySelect.value,
            status: statusSelect.value,
            platform: platformInput.value.trim() || "-"
          })
        });

        const idx = problems.findIndex((item) => item.id === problem.id);
        if (idx !== -1) {
          problems[idx] = data.problem;
        }

        renderAll();
      } catch (error) {
        alert(error.message);
      }
    });

    cancelBtn.addEventListener("click", renderTable);
    actionCell.appendChild(saveBtn);
    actionCell.appendChild(cancelBtn);
  }

  function renderTable() {
    const list = getFilteredProblems();
    table.innerHTML = "";

    for (const problem of list) {
      const row = table.insertRow();
      row.insertCell(0).textContent = problem.name;
      row.insertCell(1).textContent = problem.topic;
      row.insertCell(2).textContent = problem.difficulty;
      row.insertCell(3).textContent = problem.status;
      row.insertCell(4).textContent = problem.platform || "-";
      row.insertCell(5).textContent = formatDate(problem.createdAt);

      const actionCell = row.insertCell(6);
      actionCell.className = "actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-warning btn-small";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => renderEditableRow(row, problem));

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-danger btn-small";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        try {
          await apiRequest(`/api/problems/${problem.id}`, { method: "DELETE" });
          problems = problems.filter((item) => item.id !== problem.id);
          renderAll();
        } catch (error) {
          alert(error.message);
        }
      });

      actionCell.appendChild(editBtn);
      actionCell.appendChild(deleteBtn);
    }
  }

  function renderCharts() {
    if (typeof Chart === "undefined") {
      return;
    }

    const diff = getDifficultyCounts(problems);
    const diffData = [diff.easy, diff.medium, diff.hard];

    if (difficultyCanvas) {
      if (!difficultyChart) {
        difficultyChart = new Chart(difficultyCanvas, {
          type: "doughnut",
          data: {
            labels: ["Easy", "Medium", "Hard"],
            datasets: [
              {
                data: diffData,
                backgroundColor: ["#2da44e", "#f59e0b", "#ef4444"]
              }
            ]
          },
          options: {
            plugins: {
              legend: {
                position: "bottom"
              }
            }
          }
        });
      } else {
        difficultyChart.data.datasets[0].data = diffData;
        difficultyChart.update();
      }
    }

    if (topicCanvas) {
      const topicCounts = getTopicCounts(problems);
      const labels = Object.keys(topicCounts);
      const values = labels.map((label) => topicCounts[label]);

      if (!topicChart) {
        topicChart = new Chart(topicCanvas, {
          type: "bar",
          data: {
            labels,
            datasets: [
              {
                label: "Problems",
                data: values,
                backgroundColor: "#3b82f6"
              }
            ]
          },
          options: {
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  precision: 0
                }
              }
            },
            plugins: {
              legend: {
                display: false
              }
            }
          }
        });
      } else {
        topicChart.data.labels = labels;
        topicChart.data.datasets[0].data = values;
        topicChart.update();
      }
    }
  }

  function exportCsv() {
    if (!problems.length) {
      return;
    }

    const headers = [
      "Username",
      "Problem",
      "Topic",
      "Difficulty",
      "Status",
      "Platform",
      "Created"
    ];

    const rows = problems.map((item) => [
      user.username,
      item.name,
      item.topic,
      item.difficulty,
      item.status,
      item.platform || "-",
      formatDate(item.createdAt)
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `placement-tracker-${user.username}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function renderAll() {
    renderTable();
    renderStats();
    renderCharts();
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("problemName").value.trim();
    const topic = document.getElementById("topic").value;
    const difficulty = document.getElementById("difficulty").value;
    const status = document.getElementById("status").value;
    const platform = document.getElementById("platform").value.trim();
    const customTopic = customTopicInput?.value.trim() || "";

    if (!name) {
      return;
    }

    const resolvedTopic = topic === "Other" ? customTopic : topic;
    if (!resolvedTopic) {
      if (customTopicInput) {
        customTopicInput.focus();
      }
      alert("Please enter custom topic.");
      return;
    }

    try {
      const data = await apiRequest("/api/problems", {
        method: "POST",
        body: JSON.stringify({
          name,
          topic: resolvedTopic,
          difficulty,
          status,
          platform: platform || "-"
        })
      });

      problems.unshift(data.problem);
      form.reset();
      if (customTopicWrap) {
        customTopicWrap.style.display = "none";
      }
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  });

  topicSelectMain?.addEventListener("change", () => {
    const show = topicSelectMain.value === "Other";
    if (customTopicWrap) {
      customTopicWrap.style.display = show ? "grid" : "none";
    }
    if (!show && customTopicInput) {
      customTopicInput.value = "";
    }
  });

  [searchInput, filterDifficulty, filterStatus].forEach((node) => {
    node?.addEventListener("input", renderTable);
    node?.addEventListener("change", renderTable);
  });

  exportBtn?.addEventListener("click", exportCsv);

  clearAllBtn?.addEventListener("click", async () => {
    if (!window.confirm("Delete all your problems? This cannot be undone.")) {
      return;
    }

    try {
      await apiRequest("/api/problems", { method: "DELETE" });
      problems = [];
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  });

  themeBtn?.addEventListener("click", toggleTheme);
  logoutBtn?.addEventListener("click", async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch {
      // No action needed on logout failure.
    }
    clearToken();
    redirect("login.html");
  });

  await fetchProblems();
  renderAll();
}

document.addEventListener("DOMContentLoaded", async () => {
  applyTheme();

  const page = getPage();
  if (page === "dashboard") {
    await initDashboard();
    return;
  }

  await requireGuest();
  initAuthPages(page);
});
