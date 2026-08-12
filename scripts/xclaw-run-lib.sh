# shellcheck shell=bash
# Sourceable helpers for xclaw run exit codes.
#
#   source scripts/xclaw-run-lib.sh
#   xclaw_run_classify $?
#   xclaw_run_should_retry $? && …

# Classify exit code → token
xclaw_run_classify() {
  case "${1:-1}" in
    0)   echo "success" ;;
    2)   echo "stream_gone" ;;
    3)   echo "auth" ;;
    4)   echo "forbidden" ;;
    5)   echo "bad_request" ;;
    6)   echo "max_resume_cycles" ;;
    7)   echo "transient" ;;
    130) echo "aborted" ;;
    *)   echo "unknown" ;;
  esac
}

xclaw_run_should_retry() {
  case "${1:-1}" in
    7) return 0 ;;
    *) return 1 ;;
  esac
}

xclaw_run_should_fresh() {
  # Caller should start a new run (drop --resume)
  case "${1:-1}" in
    2) return 0 ;;
    *) return 1 ;;
  esac
}

xclaw_run_is_success() {
  [[ "${1:-1}" == "0" ]]
}

# Run xclaw and print a one-line classification
xclaw_run_checked() {
  local bin="${XCLAW_BIN:-xclaw}"
  set +e
  "$bin" run "$@"
  local code=$?
  set -e
  local kind
  kind=$(xclaw_run_classify "$code")
  echo "[xclaw_run] exit=$code class=$kind" >&2
  return "$code"
}
