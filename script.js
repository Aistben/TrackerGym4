const defaultProgram = {
    monday: {
        title: "Понедельник",
        dividerPosition: 1,
        exercises: [
            { id: 1, name: "Брусья", type: "основа", targetSets: 5, targetReps: 5 },
            { id: 2, name: "Подтягивания", type: "средняя", targetSets: 3, targetReps: 5 },
            { id: 3, name: "Приседания", type: "лёгкая", targetSets: 3, targetReps: 8 }
        ]
    },
    wednesday: {
        title: "Среда",
        dividerPosition: 2,
        exercises: [
            { id: 5, name: "Подтягивания", type: "основа", targetSets: 5, targetReps: 3 },
            { id: 4, name: "Брусья", type: "лёгкая", targetSets: 4, targetReps: 6 },
            { id: 6, name: "Тяга нижнего блока", type: "средняя", targetSets: 3, targetReps: 10 },
            { id: 7, name: "Молотки", type: "лёгкая", targetSets: 3, targetReps: 12 }
        ]
    },
    friday: {
        title: "Пятница",
        dividerPosition: 1,
        exercises: [
            { id: 8, name: "Присед", type: "основа", targetSets: 5, targetReps: 5 },
            { id: 9, name: "Румынская тяга", type: "средняя", targetSets: 3, targetReps: 6 },
            { id: 10, name: "Присед в раме", type: "лёгкая", targetSets: 3, targetReps: 8 },
            { id: 11, name: "Подтягивания (св. вес)", type: "лёгкая", targetSets: 2, targetReps: 8 },
            { id: 12, name: "Брусья (св. вес)", type: "лёгкая", targetSets: 2, targetReps: 12 }
        ]
    }
};

let program = JSON.parse(localStorage.getItem('program')) || JSON.parse(JSON.stringify(defaultProgram));
let history = JSON.parse(localStorage.getItem('history')) || {};
let completedDays = JSON.parse(localStorage.getItem('completedDays')) || {};
let currentCycle = localStorage.getItem('currentCycle') || 'force';
let currentDay = 'monday';
let addingToDay = '';
let editingExercise = null;
let nextId = 100;

function init() {
    const now = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    document.getElementById('currentDate').textContent = now.toLocaleDateString('ru-RU', options);
    const dayOfWeek = now.getDay();
    if (dayOfWeek === 1) currentDay = 'monday';
    else if (dayOfWeek === 3) currentDay = 'wednesday';
    else if (dayOfWeek === 5) currentDay = 'friday';
    ['monday', 'wednesday', 'friday'].forEach(day => {
        if (!program[day]) return;
        if (program[day].dividerPosition === undefined) {
            const firstSupport = program[day].exercises.findIndex(ex => ex.type !== 'основа');
            program[day].dividerPosition = firstSupport !== -1 ? firstSupport : program[day].exercises.length;
        }
        if (program[day].dividerPosition > program[day].exercises.length) program[day].dividerPosition = program[day].exercises.length;
        if (program[day].dividerPosition < 0) program[day].dividerPosition = 0;
    });
    setCycle(currentCycle);
    updateNavButtons();
    renderAll();
    switchDay(currentDay);
}

function setCycle(cycle) {
    currentCycle = cycle;
    localStorage.setItem('currentCycle', cycle);
    document.getElementById('cycle-force').classList.remove('active-force');
    document.getElementById('cycle-volume').classList.remove('active-volume');
    if (cycle === 'force') document.getElementById('cycle-force').classList.add('active-force');
    else document.getElementById('cycle-volume').classList.add('active-volume');
}

function updateNavButtons() {
    ['monday', 'wednesday', 'friday'].forEach(day => {
        const btn = document.getElementById(`nav-${day}`);
        if (completedDays[day]) btn.classList.add('done');
        else btn.classList.remove('done');
    });
}

function renderAll() {
    ['monday', 'wednesday', 'friday'].forEach(day => renderDay(day));
}

function renderDay(day) {
    const container = document.getElementById(`day-${day}`);
    const data = program[day];
    const divPos = data.dividerPosition;
    let html = `<div class="workout-title">${data.title}</div>`;
    html += `<div class="workout-card" id="card-${day}">`;
    data.exercises.forEach((ex, index) => {
        if (index === divPos) {
            html += `<div class="section-divider-wrapper"><div class="section-divider-line"></div><span class="section-label">⚡ Подсобные упражнения ⚡</span><div class="section-divider-line-bottom"></div></div>`;
        }
        html += renderExercise(day, ex, index);
    });
    if (divPos >= data.exercises.length) {
        html += `<div class="section-divider-wrapper"><div class="section-divider-line"></div><span class="section-label">⚡ Подсобные упражнения ⚡</span><div class="section-divider-line-bottom"></div></div>`;
    }
    html += `</div>`;
    const isCompleted = completedDays[day];
    html += `<button class="btn-finish-workout" onclick="finishWorkout('${day}')" style="${isCompleted ? 'background: linear-gradient(135deg, #555, #333); box-shadow:none;' : ''}">${isCompleted ? '✅ ТРЕНИРОВКА ЗАВЕРШЕНА' : '💾 СОХРАНИТЬ ТРЕНИРОВКУ'}</button>`;
    html += `<button class="btn-add-exercise" onclick="openAddModal('${day}')">+ Добавить упражнение</button>`;
    container.innerHTML = html;
}

function renderExercise(day, ex, index) {
    const lastEntry = getLastEntry(day, ex.id);
    const suggestion = getSuggestion(day, ex.id, ex.type);
    const intensityClass = getIntensityClass(ex.type);
    const intensityLabel = getIntensityLabel(ex.type);
    const isOsnova = ex.type === 'основа';
    return `<div class="exercise-item" data-index="${index}" data-day="${day}" data-id="${ex.id}">
        <div class="exercise-header">
            <div class="exercise-name-row">
                <span class="exercise-name">${ex.name}</span>
                <span class="exercise-intensity ${intensityClass}">${intensityLabel}</span>
            </div>
            <div class="exercise-buttons">
                ${!isOsnova ? `<button class="btn-delete" onclick="openEditModal('${day}', ${index})">✏️</button>` : ''}
                <button class="btn-move" onclick="moveExercise('${day}', ${index}, 'up')">▲</button>
                <button class="btn-move" onclick="moveExercise('${day}', ${index}, 'down')">▼</button>
                ${!isOsnova ? `<button class="btn-delete delete-red" onclick="deleteExercise('${day}', ${index})">✕</button>` : ''}
            </div>
        </div>
        ${lastEntry ? `<div class="last-result">Прошлый раз: <strong>${lastEntry.weight} кг × ${lastEntry.sets}×${lastEntry.reps}</strong>${lastEntry.note ? `<br><span class="history-note-icon">📝 ${lastEntry.note}</span>` : ''}<span style="color:#666; font-size:11px;"> (${lastEntry.date})</span></div>` : ''}
        ${suggestion ? `<div class="suggestion">💡 ${suggestion}</div>` : ''}
        <div class="exercise-inputs">
            <div class="input-group"><label>Вес (кг)</label><input type="number" step="0.5" id="weight-${day}-${ex.id}" value="${lastEntry ? lastEntry.weight : ''}" placeholder="0"></div>
            <div class="input-group"><label>Подходы</label><input type="number" id="sets-${day}-${ex.id}" value="${ex.targetSets}" placeholder="${ex.targetSets}"></div>
            <div class="input-group"><label>Повторы</label><input type="number" id="reps-${day}-${ex.id}" value="${ex.targetReps}" placeholder="${ex.targetReps}"></div>
        </div>
        <div class="exercise-note-btn"><button class="btn-note" onclick="toggleNote('note-${day}-${ex.id}')">📝 Заметка</button></div>
        <div class="note-area" id="note-${day}-${ex.id}"><textarea placeholder="Как прошло, RPE, самочувствие..." id="notetext-${day}-${ex.id}">${lastEntry && lastEntry.note ? lastEntry.note : ''}</textarea></div>
        <div class="history-section"><div class="history-title">📊 История <button class="history-toggle" onclick="toggleHistory('hist-${day}-${ex.id}')">показать</button></div><div class="history-list" id="hist-${day}-${ex.id}">${renderHistory(day, ex.id)}</div></div>
    </div>`;
}

function moveExercise(day, index, direction) {
    const exercises = program[day].exercises;
    const divPos = program[day].dividerPosition;
    if (direction === 'up') {
        if (index === 0) {
            if (divPos > 0) {
                program[day].dividerPosition = divPos - 1;
                localStorage.setItem('program', JSON.stringify(program));
                renderDay(day);
            }
            return;
        }
        const newIndex = index - 1;
        const temp = exercises[index];
        exercises[index] = exercises[newIndex];
        exercises[newIndex] = temp;
        if (index >= divPos && newIndex < divPos) program[day].dividerPosition = divPos - 1;
    }
    if (direction === 'down') {
        if (index === exercises.length - 1) {
            if (divPos <= exercises.length) {
                program[day].dividerPosition = divPos + 1;
                if (program[day].dividerPosition > exercises.length) program[day].dividerPosition = exercises.length;
            }
            localStorage.setItem('program', JSON.stringify(program));
            renderDay(day);
            return;
        }
        const newIndex = index + 1;
        const temp = exercises[index];
        exercises[index] = exercises[newIndex];
        exercises[newIndex] = temp;
        if (index < divPos && newIndex >= divPos) program[day].dividerPosition = divPos + 1;
    }
    localStorage.setItem('program', JSON.stringify(program));
    renderDay(day);
}

function finishWorkout(day) {
    const data = program[day];
    let savedCount = 0;
    data.exercises.forEach(ex => {
        const weightEl = document.getElementById(`weight-${day}-${ex.id}`);
        const setsEl = document.getElementById(`sets-${day}-${ex.id}`);
        const repsEl = document.getElementById(`reps-${day}-${ex.id}`);
        const noteEl = document.getElementById(`notetext-${day}-${ex.id}`);
        const weight = weightEl ? weightEl.value : '';
        const sets = setsEl ? setsEl.value : '';
        const reps = repsEl ? repsEl.value : '';
        const note = noteEl ? noteEl.value : '';
        if (weight && sets && reps) {
            const key = getHistoryKey(day, ex.id);
            if (!history[key]) history[key] = [];
            const now = new Date();
            const dateStr = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
            history[key].push({ date: dateStr, weight: parseFloat(weight), sets: parseInt(sets), reps: parseInt(reps), note: note, cycle: currentCycle, timestamp: now.getTime() });
            savedCount++;
        }
    });
    if (savedCount === 0) { showToast('⚠️ Заполни хотя бы одно упражнение'); return; }
    completedDays[day] = true;
    localStorage.setItem('history', JSON.stringify(history));
    localStorage.setItem('completedDays', JSON.stringify(completedDays));
    updateNavButtons();
    renderDay(day);
    showToast(`✅ Тренировка сохранена! (${savedCount} упражнений)`);
}

function getIntensityClass(type) {
    const classes = { 'основа': 'intensity-osnova', 'средняя': 'intensity-medium', 'лёгкая': 'intensity-light' };
    return classes[type] || '';
}

function getIntensityLabel(type) {
    const labels = { 'основа': 'ОСНОВА', 'средняя': 'СРЕДНЯЯ', 'лёгкая': 'ЛЁГКАЯ' };
    return labels[type] || type;
}

function getHistoryKey(day, exerciseId) {
    return `${day}_${exerciseId}`;
}

function getLastEntry(day, exerciseId) {
    const key = getHistoryKey(day, exerciseId);
    const entries = history[key];
    if (!entries || entries.length === 0) return null;
    return entries[entries.length - 1];
}

function renderHistory(day, exerciseId) {
    const key = getHistoryKey(day, exerciseId);
    const entries = history[key];
    if (!entries || entries.length === 0) return '<div style="color:#555; font-size:12px; padding:8px;">Нет записей</div>';
    return entries.slice().reverse().slice(0, 10).map(entry => `<div class="history-item"><span class="history-date">${entry.date}</span><span class="history-data">${entry.weight} кг × ${entry.sets}×${entry.reps}</span>${entry.note ? '<span class="history-note-icon">📝</span>' : ''}</div>`).join('');
}

function getSuggestion(day, exerciseId, type) {
    const key = getHistoryKey(day, exerciseId);
    const entries = history[key];
    if (!entries || entries.length < 2) return null;
    const last = entries[entries.length - 1];
    const prev = entries[entries.length - 2];
    if (type === 'лёгкая' && parseInt(last.reps) >= 15) return `Все подходы по 15 повторов — пора добавить +2 кг!`;
    if (type === 'средняя' && parseInt(last.reps) >= 12) return `Достиг 12 повторов — можно добавить +2.5 кг`;
    if (type === 'основа' && last.weight > prev.weight) return `Прогресс! ${prev.weight} → ${last.weight} кг 🔥`;
    return null;
}

function openAddModal(day) {
    addingToDay = day;
    document.getElementById('newExerciseName').value = '';
    document.getElementById('addExerciseModal').classList.add('show');
    document.getElementById('newExerciseName').focus();
}

function closeModal() {
    document.getElementById('addExerciseModal').classList.remove('show');
}

function addExercise() {
    const name = document.getElementById('newExerciseName').value.trim();
    const type = document.getElementById('newExerciseType').value;
    if (!name) { showToast('⚠️ Введи название'); return; }
    const targetSets = 3;
    const targetReps = type === 'средняя' ? 8 : 12;
    program[addingToDay].exercises.push({ id: nextId++, name: name, type: type, targetSets: targetSets, targetReps: targetReps });
    localStorage.setItem('program', JSON.stringify(program));
    closeModal();
    renderDay(addingToDay);
    showToast(`✅ ${name} добавлено!`);
}

function openEditModal(day, index) {
    editingExercise = { day, index };
    const ex = program[day].exercises[index];
    document.getElementById('editExerciseName').value = ex.name;
    document.getElementById('editExerciseType').value = ex.type;
    document.getElementById('editExerciseModal').classList.add('show');
}

function closeEditModal() {
    document.getElementById('editExerciseModal').classList.remove('show');
}

function saveEditExercise() {
    const { day, index } = editingExercise;
    const name = document.getElementById('editExerciseName').value.trim();
    const type = document.getElementById('editExerciseType').value;
    if (!name) { showToast('⚠️ Введи название'); return; }
    program[day].exercises[index].name = name;
    program[day].exercises[index].type = type;
    localStorage.setItem('program', JSON.stringify(program));
    closeEditModal();
    renderDay(day);
    showToast('✅ Изменено!');
}

function deleteExercise(day, index) {
    const ex = program[day].exercises[index];
    if (confirm(`Удалить "${ex.name}"?`)) {
        if (index < program[day].dividerPosition) program[day].dividerPosition--;
        program[day].exercises.splice(index, 