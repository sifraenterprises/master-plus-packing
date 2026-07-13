# Auth Testing Playbook — Grewal Engineering Work

Auth is username-based (not email). Users seeded on startup from backend/.env.

Step 1: MongoDB Verification
```
mongosh
use test_database
db.users.find().pretty()
db.users.findOne({role: "admin"}, {password_hash: 1})
```
Verify: bcrypt hash starts with `$2b$`, unique index on users.username.

Step 2: API Testing
```
curl -X POST http://localhost:8001/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"5@Sohangso"}'
# → returns {token, user}. Then:
curl http://localhost:8001/api/auth/me -H "Authorization: Bearer <token>"
```

Step 3: RBAC
- dispatch user must get 403 on /api/admin/* endpoints.
- Brute force: 6th failed login within 15 min → 429.
