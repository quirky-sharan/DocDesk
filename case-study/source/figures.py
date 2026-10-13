# -*- coding: utf-8 -*-
"""Black-and-white line diagrams for the case study. Each function returns a Drawing."""
import math

from reportlab.graphics.shapes import Drawing, Line, PolyLine, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.pdfbase.pdfmetrics import stringWidth

F, FB, FI = 'TNR', 'TNR-Bold', 'TNR-Italic'
BLACK, WHITE = colors.black, colors.white


# ------------------------------------------------------------------ helpers
def wrap(text, font, size, width):
    lines, cur = [], ''
    for word in text.split():
        trial = (cur + ' ' + word).strip()
        if not cur or stringWidth(trial, font, size) <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def label(d, x, y, text, size=8, anchor='middle', font=F):
    d.add(String(x, y, text, fontName=font, fontSize=size, textAnchor=anchor, fillColor=BLACK))


def box(d, x, y, w, h, title=None, text=None, size=8.5, dash=None, stroke=0.8,
        align='center', valign='middle', pad=6):
    d.add(Rect(x, y, w, h, fillColor=WHITE, strokeColor=BLACK, strokeWidth=stroke,
               strokeDashArray=dash))
    lines = []
    if title:
        lines += [(ln, FB) for ln in wrap(title, FB, size, w - 2 * pad)]
    if text:
        for para in (text if isinstance(text, (list, tuple)) else [text]):
            lines += [(ln, F) for ln in wrap(para, F, size, w - 2 * pad)]
    lh = size * 1.22
    if valign == 'top':
        top = y + h - 4
    else:
        top = y + h / 2.0 + lh * len(lines) / 2.0
    for i, (ln, font) in enumerate(lines):
        base = top - lh * (i + 1) + size * 0.30
        if align == 'center':
            label(d, x + w / 2.0, base, ln, size, 'middle', font)
        else:
            label(d, x + pad, base, ln, size, 'start', font)


def arrow(d, x1, y1, x2, y2, head=5.5, width=0.8, dash=None, both=False):
    d.add(Line(x1, y1, x2, y2, strokeColor=BLACK, strokeWidth=width, strokeDashArray=dash))

    def tip(px, py, ang):
        a1, a2 = ang + math.radians(156), ang - math.radians(156)
        d.add(Polygon([px, py, px + head * math.cos(a1), py + head * math.sin(a1),
                       px + head * math.cos(a2), py + head * math.sin(a2)],
                      fillColor=BLACK, strokeColor=BLACK, strokeWidth=0.4))

    ang = math.atan2(y2 - y1, x2 - x1)
    tip(x2, y2, ang)
    if both:
        tip(x1, y1, ang + math.pi)


def entity(d, x, top, w, name, attrs, size=7.6):
    """A table drawn as a box: name in the header, columns listed below."""
    lh = size * 1.24
    head = lh + 5
    h = head + 2 + lh * len(attrs) + 3
    y = top - h
    d.add(Rect(x, y, w, h, fillColor=WHITE, strokeColor=BLACK, strokeWidth=0.8))
    d.add(Line(x, top - head, x + w, top - head, strokeColor=BLACK, strokeWidth=0.8))
    label(d, x + w / 2.0, top - head + 4.4, name, size + 0.6, 'middle', FB)
    for i, a in enumerate(attrs):
        label(d, x + 5, top - head - 2 - lh * (i + 1) + size * 0.30, a, size, 'start')
    return {'x': x, 'y': y, 'w': w, 'h': h, 'top': top, 'r': x + w, 'cx': x + w / 2.0}


def link(d, x1, y1, x2, y2, c1='1', c2='N', size=7.6):
    """Relationship line with a cardinality mark at each end."""
    d.add(Line(x1, y1, x2, y2, strokeColor=BLACK, strokeWidth=0.8))
    if abs(y1 - y2) < 0.5:
        near, far = ('start', 'end') if x2 > x1 else ('end', 'start')
        sx = 1 if x2 > x1 else -1
        label(d, x1 + sx * 3.5, y1 + 2.6, c1, size, near, FB)
        label(d, x2 - sx * 3.5, y2 + 2.6, c2, size, far, FB)
    else:
        sy = 1 if y2 > y1 else -1
        label(d, x1 + 4, y1 + sy * 7 - size * 0.33, c1, size, 'start', FB)
        label(d, x2 + 4, y2 - sy * 7 - size * 0.33, c2, size, 'start', FB)


# ------------------------------------------------------------------ figures
def fig_architecture(width):
    H = 338
    d = Drawing(width, H)
    side_w, gap = 76, 10
    mw = width - side_w - gap                 # width of the main column
    cx = mw / 2.0

    # clients
    cw = (mw - 2 * 11) / 3.0
    clients = [('O3 application', 'React frontend modules running in the browser'),
               ('Older user interfaces', 'Legacy UI and Reference Application 2.x pages'),
               ('Other systems', 'FHIR, REST and HL7 version 2 clients')]
    for i, (t, s) in enumerate(clients):
        x = i * (cw + 11)
        box(d, x, H - 38, cw, 38, t, s, size=8)
        arrow(d, x + cw / 2.0, H - 38, x + cw / 2.0, H - 54)

    layers = [
        (H - 102, 48, 'Web layer (inside a servlet container such as Tomcat)',
         ['Servlet filters, Spring MVC controllers, REST resources under /ws/rest/v1 '
          'and FHIR R4 resources under /ws/fhir2/R4']),
        (H - 182, 66, 'Service layer (the OpenMRS API)',
         ['PatientService, EncounterService, ObsService, ConceptService, UserService and '
          'others, reached through the Context class',
          'Every call first passes the authorization advice (@Authorized), the '
          'required-data advice and the transaction interceptor']),
        (H - 242, 46, 'Data access layer',
         ['DAO interfaces with Hibernate implementations: HQL, Criteria queries, native SQL '
          'and full-text queries']),
        (H - 290, 34, 'Hibernate ORM',
         ['second-level cache (Infinispan), C3P0 connection pool, JDBC driver']),
    ]
    prev_bottom = None
    for y, h, t, s in layers:
        if prev_bottom is not None:
            arrow(d, cx, prev_bottom, cx, y + h)
        box(d, 0, y, mw, h, t, s, size=8.5)
        prev_bottom = y

    # stores
    box(d, 0, 0, mw * 0.58, 34, 'Relational database', 'MySQL, MariaDB or PostgreSQL', size=8.5)
    box(d, mw * 0.58 + 14, 0, mw * 0.42 - 14, 34, 'Full-text index',
        'Lucene files or Elasticsearch', size=8.5)
    arrow(d, mw * 0.29, H - 290, mw * 0.29, 34)
    arrow(d, mw * 0.79 + 7, H - 290, mw * 0.79 + 7, 34)

    # modules bar
    box(d, mw + gap, H - 290, side_w, 290, 'Modules (.omod files)',
        ['Each module can add its own services, data access objects, tables, REST '
         'resources, pages, servlet filters and advice.'], size=8)
    return d


def fig_deployment(width):
    H = 232
    d = Drawing(width, H)
    box(d, 117, 204, 100, 28, 'Web browser', size=8.5)
    box(d, 62, 146, 210, 38, 'Gateway container (nginx)',
        'routes requests by URL path and adds security headers', size=8.5)
    box(d, 0, 72, 150, 50, 'Frontend container',
        'static files of the O3 application, served under /openmrs/spa', size=8.5)
    box(d, 170, 72, 165, 50, 'Backend container',
        'OpenMRS Platform on Tomcat (port 8080) with the REST, FHIR2 and other modules',
        size=8.5)
    box(d, 170, 0, 165, 50, 'Database container',
        'MariaDB 10.11 with the utf8mb4 character set; data kept in volume db-data', size=8.5)
    box(d, 0, 0, 150, 50, 'Volume openmrs-data',
        'application data directory: search index, uploaded files, configuration', size=8.5)
    box(d, 355, 72, width - 355, 50, 'Identity provider',
        'optional, for example Keycloak', size=8.5, dash=[3, 2])
    box(d, 355, 0, width - 355, 50, 'Elasticsearch',
        'optional search back end (Platform 2.8)', size=8.5, dash=[3, 2])

    arrow(d, 167, 204, 167, 184)
    label(d, 173, 191, 'HTTP or HTTPS', 8, 'start', FI)
    arrow(d, 112, 146, 80, 122)
    label(d, 88, 133, '/openmrs/spa', 8, 'end', FI)
    arrow(d, 222, 146, 250, 122)
    label(d, 243, 133, '/openmrs', 8, 'start', FI)
    arrow(d, 252, 72, 252, 50)
    label(d, 258, 58, 'JDBC', 8, 'start', FI)
    arrow(d, 170, 80, 150, 44)
    arrow(d, 335, 97, 355, 97, dash=[3, 2], both=True)
    arrow(d, 335, 76, 355, 46, dash=[3, 2])
    return d


def fig_er_core(width):
    H = 392
    d = Drawing(width, H)
    w = 132.0
    xs = [0.0, (width - w) / 2.0, width - w]
    gap = 24

    row1 = [
        ('person', ['person_id  (PK)', 'gender, birthdate', 'dead, death_date',
                    'creator, date_created', 'voided, void_reason', 'uuid']),
        ('patient', ['patient_id  (PK, FK to person)', 'allergy_status',
                     'creator, date_created', 'voided, void_reason']),
        ('patient_identifier', ['patient_identifier_id  (PK)', 'patient_id  (FK)', 'identifier',
                                'identifier_type  (FK)', 'location_id  (FK)',
                                'preferred, voided, uuid']),
    ]
    row2 = [
        ('person_name', ['person_name_id  (PK)', 'person_id  (FK)', 'given_name, middle_name',
                         'family_name', 'preferred, voided, uuid']),
        ('visit', ['visit_id  (PK)', 'patient_id  (FK)', 'visit_type_id  (FK)',
                   'date_started, date_stopped', 'location_id  (FK)', 'voided, uuid']),
        ('location', ['location_id  (PK)', 'name, description', 'address columns',
                      'parent_location  (FK)', 'retired, uuid']),
    ]
    row3 = [
        ('concept_name', ['concept_name_id  (PK)', 'concept_id  (FK)', 'name',
                          'locale, locale_preferred', 'concept_name_type, voided']),
        ('encounter', ['encounter_id  (PK)', 'patient_id  (FK)', 'visit_id  (FK)',
                       'encounter_type  (FK)', 'encounter_datetime',
                       'location_id, form_id  (FKs)']),
        ('orders', ['order_id  (PK)', 'patient_id, encounter_id  (FKs)', 'concept_id  (FK)',
                    'orderer  (FK to provider)', 'order_type_id, care_setting',
                    'order_action, date_activated']),
    ]
    row4 = [
        ('concept', ['concept_id  (PK)', 'datatype_id  (FK)', 'class_id  (FK)',
                     'is_set, retired', 'uuid']),
        ('obs', ['obs_id  (PK)', 'person_id, encounter_id  (FKs)', 'concept_id  (FK)',
                 'obs_datetime, location_id', 'value_numeric, value_coded,',
                 'value_text, value_datetime, ...', 'obs_group_id, previous_version']),
        ('provider', ['provider_id  (PK)', 'person_id  (FK)', 'name, identifier',
                      'retired, uuid']),
    ]
    grid, top = [], H
    for row in (row1, row2, row3, row4):
        ents = [entity(d, xs[i], top, w, name, attrs) for i, (name, attrs) in enumerate(row)]
        grid.append(ents)
        top = min(e['y'] for e in ents) - gap

    def hlink(a, b, c1, c2, dy=30):
        y = a['top'] - dy
        link(d, a['r'], y, b['x'], y, c1, c2)

    def vlink(a, b, c1, c2):
        link(d, a['cx'], a['y'], b['cx'], b['top'], c1, c2)

    hlink(grid[0][0], grid[0][1], '1', '0..1')          # person - patient
    hlink(grid[0][1], grid[0][2], '1', 'N')             # patient - identifiers
    vlink(grid[0][0], grid[1][0], '1', 'N')             # person - names
    vlink(grid[0][1], grid[1][1], '1', 'N')             # patient - visits
    hlink(grid[1][1], grid[1][2], 'N', '1')             # visit - location
    vlink(grid[1][1], grid[2][1], '1', 'N')             # visit - encounters
    hlink(grid[2][1], grid[2][2], '1', 'N')             # encounter - orders
    vlink(grid[2][1], grid[3][1], '1', 'N')             # encounter - obs
    vlink(grid[2][0], grid[3][0], 'N', '1')             # concept names - concept
    hlink(grid[3][0], grid[3][1], '1', 'N')             # concept - obs
    vlink(grid[2][2], grid[3][2], 'N', '1')             # orders - provider
    return d


def fig_rbac_er(width):
    H = 196
    d = Drawing(width, H)
    lw, mw, rw = 132.0, 100.0, 128.0
    mx = (width - mw) / 2.0 - 2
    rx = width - rw

    users = entity(d, 0, H, lw, 'users',
                   ['user_id  (PK)', 'system_id', 'username', 'password  (hash)', 'salt',
                    'secret_question, secret_answer', 'email, activation_key',
                    'person_id  (FK to person)', 'creator, date_created, changed_by',
                    'retired, retired_by, uuid'], size=7.8)
    uprop = entity(d, 0, users['y'] - 26, lw, 'user_property',
                   ['user_id  (PK, FK)', 'property  (PK)', 'property_value'], size=7.8)
    urole = entity(d, mx, H - 18, mw, 'user_role',
                   ['user_id  (PK, FK)', 'role  (PK, FK)'], size=7.8)
    role = entity(d, rx, H, rw, 'role', ['role  (PK)', 'description', 'uuid'], size=7.8)
    rpriv = entity(d, rx, role['y'] - 26, rw, 'role_privilege',
                   ['role  (PK, FK)', 'privilege  (PK, FK)'], size=7.8)
    priv = entity(d, rx, rpriv['y'] - 26, rw, 'privilege',
                  ['privilege  (PK)', 'description', 'uuid'], size=7.8)
    rrole = entity(d, mx, H - 76, mw, 'role_role',
                   ['parent_role  (PK, FK)', 'child_role  (PK, FK)'], size=7.8)
    gprop = entity(d, mx - 12, 70, mw + 24, 'global_property',
                   ['property  (PK)', 'property_value', 'view_privilege  (FK)',
                    'edit_privilege  (FK)', 'delete_privilege  (FK)'], size=7.8)

    y = H - 38
    link(d, users['r'], y, urole['x'], y, '1', 'N')
    link(d, urole['r'], y, role['x'], y, 'N', '1')
    link(d, users['cx'], users['y'], uprop['cx'], uprop['top'], '1', 'N')
    link(d, role['cx'], role['y'], rpriv['cx'], rpriv['top'], '1', 'N')
    link(d, rpriv['cx'], rpriv['y'], priv['cx'], priv['top'], 'N', '1')

    # role_role: both of its columns point at role (role inheritance)
    ry = rrole['y'] + rrole['h'] / 2.0
    sx = role['x'] + 12                       # leaves the bottom edge of role
    ex = (urole['r'] + role['x']) / 2.0 + 2   # runs down between the two columns
    ey = role['y'] - 13
    d.add(PolyLine([sx, role['y'], sx, ey, ex, ey, ex, ry, rrole['r'], ry], strokeColor=BLACK,
                   strokeWidth=0.8, fillColor=None))
    label(d, sx + 4, role['y'] - 9.5, '1', 7.8, 'start', FB)
    label(d, rrole['r'] + 3.5, ry + 2.6, 'N', 7.8, 'start', FB)

    gy = priv['y'] + 22
    link(d, gprop['r'], gy, priv['x'], gy, 'N', '1')
    return d


def fig_request_path(width):
    steps = [
        ('HTTP request',
         'GET /openmrs/ws/rest/v1/patient?q=..., with a session cookie or Basic credentials'),
        ('Servlet filter chain',
         'OpenmrsFilter binds the user context to the thread; CSRF and module filters follow'),
        ('REST resource', 'calls the patient service: getPatients(query, start, limit)'),
        ('Authorization advice',
         'reads @Authorized on the method and checks the privilege Get Patients'),
        ('Transaction interceptor', 'starts a read-only transaction on the Hibernate session'),
        ('Service and DAO', 'PatientServiceImpl passes the search to HibernatePatientDAO'),
        ('Hibernate',
         'full-text query for matching names and identifiers, then SQL to load the rows'),
        ('Database server',
         'executes the SQL over a pooled JDBC connection and returns the rows'),
        ('Response',
         'the resource turns the Patient objects into JSON in the requested representation'),
    ]
    bh, gap = 30, 10
    H = len(steps) * bh + (len(steps) - 1) * gap
    d = Drawing(width, H)
    bx, bw = 22, 322
    for i, (title, text) in enumerate(steps):
        y = H - (i + 1) * bh - i * gap
        box(d, bx, y, bw, bh, title, text, size=8, align='left')
        label(d, 8, y + bh / 2.0 - 3, str(i + 1), 9.5, 'middle', FB)
        if i < len(steps) - 1:
            arrow(d, bx + bw / 2.0, y, bx + bw / 2.0, y - gap, head=4.5)
        if i == 3:
            rx = bx + bw + 20
            box(d, rx, y - 10, width - rx, bh + 20, 'Privilege missing',
                'the call is refused with an authentication exception', size=7.8,
                dash=[3, 2])
            arrow(d, bx + bw, y + bh / 2.0, rx, y + bh / 2.0, head=4.5)
    return d


def fig_layers(width):
    layers = [
        ('Network and transport',
         'HTTPS on the gateway or web server, set up by the implementer; firewall rules'),
        ('Web layer',
         'session cookie, CSRF token (OWASP CSRFGuard), security headers, optional IP '
         'allow-list for the REST interface'),
        ('Authentication',
         'password with lockout and password rules; optional second factor (TOTP) or '
         'OAuth 2.0 login through an identity provider'),
        ('Authorization (role-based access control)',
         'privilege check before every service method; privileges reach users through roles'),
        ('Row filters (optional)',
         'the Data Filter module limits patients, visits, encounters and observations by '
         'location, program or privilege'),
    ]
    inset_x, inset_b, band, inner_h = 13, 7, 34, 58
    n = len(layers)
    H = n * band + inner_h + n * inset_b
    d = Drawing(width, H)
    size = 8.3
    lh = size * 1.22
    for i, (title, text) in enumerate(layers):
        x = inset_x * i
        y = inset_b * i
        w = width - 2 * x
        h = H - band * i - y
        d.add(Rect(x, y, w, h, fillColor=WHITE, strokeColor=BLACK, strokeWidth=0.8))
        top = y + h - 3
        label(d, x + 7, top - lh + size * 0.30, title, size, 'start', FB)
        for k, ln in enumerate(wrap(text, F, size, w - 14 - 2 * inset_x)):
            label(d, x + 7, top - lh * (k + 2) + size * 0.30, ln, size, 'start')
    x = inset_x * n
    y = inset_b * n
    box(d, x, y, width - 2 * x, inner_h, 'Database',
        ['one application account, foreign keys, voided and retired rows instead of deletes, '
         'audit columns, optional Envers revision tables; encryption at rest is left to the '
         'DBMS or the disk'], size=size, stroke=1.3)
    return d
