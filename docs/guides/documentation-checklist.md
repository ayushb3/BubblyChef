# Documentation Update Checklist

**Use this checklist after implementing any feature!**

---

## 🎯 Quick Decision Tree

### Did you add/change API endpoints?
✅ **YES** → Update:
- [ ] `CLAUDE.md` - API Reference section
- [ ] Swagger docs (check `/docs` endpoint)

### Did you modify data models?
✅ **YES** → Update:
- [ ] `CLAUDE.md` - Key Concepts section
- [ ] `web/src/types/index.ts` - TypeScript types
- [ ] `docs/architecture/overview.md` - Data model diagram

### Did you change the receipt scanning flow?
✅ **YES** → Update:
- [ ] `CLAUDE.md` - Receipt Scanning Flow section
- [ ] `docs/architecture/overview.md` - Data flow diagram

### Did you add business logic (normalizer, expiry, defaults)?
✅ **YES** → Update:
- [ ] `CLAUDE.md` - Domain Logic section
- [ ] Add inline code comments

### Did you add environment variables?
✅ **YES** → Update:
- [ ] `CLAUDE.md` - Configuration section
- [ ] `.env.example` - Add new variable with description
- [ ] `README.md` - Prerequisites section if required

### Did you change project structure?
✅ **YES** → Update:
- [ ] `CLAUDE.md` - Project Structure section
- [ ] `README.md` - Project Structure section

### Did you complete a TODO item?
✅ **YES** → Update:
- [ ] `docs/TODO.md` - Mark as complete
- [ ] Add any new tasks discovered during implementation

---

## 📝 Standard Commit Message Format

```
<type>: <short summary>

<optional body with details>

Docs updated:
- CLAUDE.md: <section updated>
- TODO.md: Marked <task> as complete
- Other: <any other docs>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `refactor`: Code restructuring (no behavior change)
- `test`: Adding tests
- `chore`: Maintenance (deps, config)

---

## 🚨 Critical Documentation Files

| File | When to Update |
|------|----------------|
| **CLAUDE.md** | Any architecture, API, or workflow change |
| **README.md** | User-facing features, setup changes |
| **docs/TODO.md** | Task completion, new bugs/tasks |
| **.env.example** | New environment variables |
| **web/src/types/index.ts** | API response changes |

---

## ✅ Post-Feature Checklist

After implementing a feature, verify:

1. **Code works**
   - [ ] Tested locally (backend + frontend)
   - [ ] Tests pass (`pytest`)
   - [ ] Frontend builds (`npm run build`)

2. **Documentation updated**
   - [ ] CLAUDE.md updated (if applicable)
   - [ ] TODO.md updated
   - [ ] Commit message includes doc changes

3. **Clean up**
   - [ ] Remove console.logs
   - [ ] Remove commented code
   - [ ] No temporary files committed

4. **Commit**
   - [ ] Clear commit message
   - [ ] Mention doc updates in commit body

---

## 📋 Feature-Specific Checklists

### Adding a New Domain Service

- [ ] Create service in `bubbly_chef/domain/`
- [ ] Write unit tests in `tests/domain/`
- [ ] Update `CLAUDE.md` - Domain Logic section
- [ ] Document in code with docstrings
- [ ] Add to `bubbly_chef/api/deps.py` if needed for DI

### Adding a New API Endpoint

- [ ] Add route in `bubbly_chef/api/routes/`
- [ ] Write tests in `tests/api/`
- [ ] Update `CLAUDE.md` - API Reference section
- [ ] Add React Query hook in `web/src/api/client.ts`
- [ ] Update TypeScript types in `web/src/types/index.ts`
- [ ] Test endpoint via Swagger UI (`/docs`)

### Adding a Frontend Page

- [ ] Create page in `web/src/pages/`
- [ ] Add route in `web/src/App.tsx`
- [ ] Update navigation component
- [ ] Update `CLAUDE.md` - Project Structure if significant
- [ ] Add to README.md feature list if user-facing

### Changing Receipt Scanning Logic

- [ ] Update `bubbly_chef/services/receipt_parser.py`
- [ ] Update tests in `tests/services/test_receipt_parser.py`
- [ ] Update `CLAUDE.md` - Receipt Scanning Flow section
- [ ] Document changes in `docs/TODO.md` if partial
- [ ] Update `web/src/pages/Scan.tsx` if UI changes

### Adding Smart Defaults

- [ ] Update `bubbly_chef/domain/defaults.py`
- [ ] Write tests in `tests/domain/test_defaults.py`
- [ ] Update `CLAUDE.md` - Smart Defaults section
- [ ] Document reasoning in code comments

---

## 🎯 Documentation Quality Standards

### CLAUDE.md
- Keep architecture diagrams up to date
- Include code examples for new patterns
- Update version number in header
- Add "Last Updated" date

### README.md
- Keep "Features" section current
- Update "Quick Start" if setup changes
- Ensure all links work

### docs/TODO.md
- Mark completed items with [x]
- Add discovered issues immediately
- Update "Last Updated" date
- Move completed items to "Completed" section

### Code Comments
- Docstrings for all public functions
- Explain "why" not "what"
- Update comments when refactoring
- Remove outdated comments

---

## 🔄 Review Before Commit

```bash
# 1. Check what changed
git status
git diff

# 2. Review documentation files
git diff CLAUDE.md
git diff docs/TODO.md
git diff README.md

# 3. Verify tests pass
pytest

# 4. Verify frontend builds
cd web && npm run build

# 5. Commit with doc updates mentioned
git add .
git commit -m "feat: Add feature X

Updated documentation:
- CLAUDE.md: Added X to API reference
- TODO.md: Marked task Y as complete
"
```

---

## 💡 Pro Tips

1. **Update docs as you code** - Don't wait until the end
2. **Use this checklist** - Reference it at start of every feature
3. **Small, frequent commits** - Easier to track doc changes
4. **Link commits to TODO items** - Reference task numbers
5. **Keep CLAUDE.md comprehensive** - It's your AI assistant's brain

---

**Remember:** Good documentation = Future you will thank present you! 🙏
