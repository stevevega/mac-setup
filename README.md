# Mac Setup
Ansible playbook to setup a Mac with basic stuff.

# Usage
Make sure to have Xcode and [Ansible](http://docs.ansible.com/ansible/intro_installation.html#latest-releases-via-pip) installed:

```sh
xcode-select --install
sudo easy_install pip
sudo pip install ansible
```

Then run the following command:

```sh
ansible-playbook -i inventories/localhost mac.yml -vvv
```
