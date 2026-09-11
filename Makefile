.PHONY: install run run-mock validate test typecheck lint
install: ; npm ci
run: ; npm start
run-mock: ; LLM_PROVIDER=mock npm start
validate: ; npm run validate
test: ; npm test
typecheck: ; npm run typecheck
lint: ; npm run lint
