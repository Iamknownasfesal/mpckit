# CI deploy identity

The `deploy` workflow used to authenticate with a cluster-admin
kubeconfig stored in `KUBECONFIG_TESTNET`. That gave every workflow
run (and anyone who could exfiltrate the secret) full cluster
control. This directory holds the scoped replacement: a ServiceAccount
in `mpckit-testnet` whose permissions are limited to the resources
`kubectl apply -k overlays/testnet` actually touches, with no Secret
reads and no exec.

## One-time bootstrap

Run once with your admin kubeconfig. The `Namespace` and the CI
`ServiceAccount`/`Role`/`Secret` are cluster-scoped (or live in a
namespace that doesn't yet exist) so the scoped CI identity can't
create them — admin has to:

```sh
kubectl apply -f infra/k8s/base/namespace.yaml
kubectl apply -f infra/k8s/ci/rbac.yaml
```

Build the CI kubeconfig:

```sh
NS=mpckit-testnet
SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
CA=$(kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
TOKEN=$(kubectl -n $NS get secret mpckit-ci-token -o jsonpath='{.data.token}' | base64 -d)

cat > /tmp/ci-kubeconfig <<EOF
apiVersion: v1
kind: Config
clusters:
- name: mpckit
  cluster:
    server: $SERVER
    certificate-authority-data: $CA
contexts:
- name: mpckit-ci
  context:
    cluster: mpckit
    namespace: $NS
    user: mpckit-ci
current-context: mpckit-ci
users:
- name: mpckit-ci
  user:
    token: $TOKEN
EOF
```

Verify the scope is right (the third and fourth should both return
`no`):

```sh
KUBECONFIG=/tmp/ci-kubeconfig kubectl auth can-i list deployments -n mpckit-testnet
KUBECONFIG=/tmp/ci-kubeconfig kubectl auth can-i get secrets -n mpckit-testnet
KUBECONFIG=/tmp/ci-kubeconfig kubectl auth can-i create pods --subresource=exec -n mpckit-testnet
KUBECONFIG=/tmp/ci-kubeconfig kubectl auth can-i list pods -n kube-system
```

Push to GitHub Secrets, then wipe the local copy:

```sh
base64 < /tmp/ci-kubeconfig | tr -d '\n' \
  | gh secret set KUBECONFIG_TESTNET --repo Iamknownasfesal/mpckit
shred -u /tmp/ci-kubeconfig
```

## Rotation

Delete the Secret, re-apply the file. Old token is invalidated; new
one is minted by the controller.

```sh
kubectl -n mpckit-testnet delete secret mpckit-ci-token
kubectl apply -f infra/k8s/ci/rbac.yaml
```

Then re-run the kubeconfig build steps above and update the GitHub
secret.

## Adding a verb when CI fails with `forbidden`

If a future overlay change introduces a new resource and CI errors
with `cannot patch resource "X" in API group "Y"`, add a minimal rule
to the `Role` in `rbac.yaml`:

```yaml
  - apiGroups: ["Y"]
    resources: ["X"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
```

Re-apply with admin: `kubectl apply -f infra/k8s/ci/rbac.yaml`. The
token does not change, so no GitHub-secret update is needed.

## `prod` environment approval

`deploy.yml` already declares `environment: prod` on the deploy job.
Enable the approval gate in the GitHub UI so deploys pause for a
human click before mutating the cluster:

1. https://github.com/Iamknownasfesal/mpckit/settings/environments
2. Click **prod** (or create it)
3. Tick **Required reviewers**, add yourself, save.
