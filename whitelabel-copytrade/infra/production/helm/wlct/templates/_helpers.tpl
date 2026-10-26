{{/* # Stable chart names, selectors, and immutable image references. */}}
{{- define "wlct.name" -}}{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}{{- end -}}
{{- define "wlct.labels" -}}
app.kubernetes.io/name: {{ include "wlct.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Values.releaseTag | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}
{{- define "wlct.selector" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}
{{- define "wlct.image" -}}{{ .image }}:{{ .tag }}{{- end -}}
